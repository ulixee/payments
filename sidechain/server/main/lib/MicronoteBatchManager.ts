import Log from '@ulixee/commons/lib/Logger';
import * as moment from 'moment';
import config from '../../config';
import Wallet from '../models/Wallet';
import MicronoteBatch from '../models/MicronoteBatch';
import BatchDb from '../../batch/db';
import MainDb from '../db';
import { InsufficientFundsError, NotFoundError } from '../../utils/errors';
import Note from '../models/Note';
import MicronoteBatchOutput from '../models/MicronoteBatchOutput';
import { bridgeToBatch } from '../../batch';

const { log } = Log(module);

export default class MicronoteBatchManager {
  private static logger = log.createChild(module, { action: 'MicronoteBatchManager' });
  private static openBatchesBySlug = new Map<string, MicronoteBatch>();
  private static pendingSettlementBatchesBySlug = new Map<string, MicronoteBatch>();
  private static refreshInterval: NodeJS.Timeout;

  public static getOpenBatches(): MicronoteBatch[] {
    return [...this.openBatchesBySlug.values()];
  }

  public static stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  public static async refresh(): Promise<void> {
    await MicronoteBatchManager.monitor();
  }

  public static async start(): Promise<void> {
    if (!this.refreshInterval) {
      await MicronoteBatchManager.monitor();
      // re-check micronoteBatch state every 5 seconds
      this.refreshInterval = setInterval(() => MicronoteBatchManager.monitor(false), 5000).unref();
    }
  }

  public static async createNewBatches(): Promise<void> {
    let counterNeeded = MicronoteBatchManager.countNewBatchesNeeded();

    while (counterNeeded > 0) {
      await MainDb.transaction(
        async client => {
          const batch = await MicronoteBatch.create(client);

          const dbName = BatchDb.getName(batch.slug);
          await MainDb.query(`CREATE DATABASE ${dbName}`);

          await BatchDb.createDb(batch.slug, this.logger);
          this.updateCached(batch);
          this.logger.info('MicronoteBatch.open', {
            openTime: batch.data.openTime,
            slug: batch.slug,
          });
        },
        { logger: this.logger },
      );
      counterNeeded -= 1;
    }
  }

  public static get(slug?: string): MicronoteBatch {
    let batchSlug = slug;

    // if no slug provided, find newest one
    if (!batchSlug) {
      const batch = [...this.openBatchesBySlug.values()].sort((a, b) => {
        const timeA = a.data.openTime.getTime();
        const timeB = b.data.openTime.getTime();
        return timeB - timeA;
      });
      if (batch.length) {
        batchSlug = batch.shift().slug;
      }
    }

    if (MicronoteBatchManager.pendingSettlementBatchesBySlug.has(batchSlug)) {
      return MicronoteBatchManager.pendingSettlementBatchesBySlug.get(batchSlug);
    }

    if (MicronoteBatchManager.openBatchesBySlug.has(batchSlug)) {
      return MicronoteBatchManager.openBatchesBySlug.get(batchSlug);
    }

    throw new NotFoundError('Batch unavailable', batchSlug);
  }

  private static countNewBatchesNeeded(): number {
    const openForGreaterThan2MoreHours = [...this.openBatchesBySlug.values()].filter(
      x => moment(x.data.stopNewNotesTime).diff(moment(), 'hours', true) > 2,
    );

    return config.micronoteBatch.minimumOpen - openForGreaterThan2MoreHours.length;
  }

  private static updateCached(batch: MicronoteBatch): void {
    // record cache
    if (batch.isSettled) {
      MicronoteBatchManager.openBatchesBySlug.delete(batch.slug);
      MicronoteBatchManager.pendingSettlementBatchesBySlug.delete(batch.slug);
    } else if (batch.isAllowingNewNotes === false) {
      MicronoteBatchManager.openBatchesBySlug.delete(batch.slug);
      MicronoteBatchManager.pendingSettlementBatchesBySlug.set(batch.slug, batch);
    } else {
      // still open
      MicronoteBatchManager.openBatchesBySlug.set(batch.slug, batch);
    }
  }

  private static closeBatch(batchAddress: string): Promise<void> {
    const transactionOptions = { logger: this.logger };

    return MainDb.transaction(async client => {
      const batch = await MicronoteBatch.lock(client, batchAddress);
      // make sure not closed
      if (batch.isClosed) {
        this.logger.info('Not closing micronote batch.  Already closed.');
        return;
      }
      const batchBalance = await Wallet.getBalance(client, batch.address);
      const noteHashes = await Wallet.getNoteHashes(client, batch.address);
      await bridgeToBatch.closeBatch(batch.slug, batchBalance, noteHashes, transactionOptions);
      await batch.recordStateTime('closedTime');
    }, transactionOptions);
  }

  private static async settleBatch(batchAddress: string): Promise<void> {
    const transactionOptions = { logger: this.logger };

    // NOTE: funky transaction/loading matters here. Need to keep streams open and rollback appropriately
    await MainDb.transaction(async client => {
      // lock first
      const batch = await MicronoteBatch.lock(client, batchAddress);
      if (batch.isSettled) {
        client.logger.warn('Not settling micronoteBatch.  Already settled');
        return batch.data;
      }

      // lock wallet on ledger
      const wallet = new Wallet(client, batch.address);
      await wallet.lock();

      const batchOutput = await bridgeToBatch.getBatchSummary(batch.slug);
      await bridgeToBatch.getBatchOutputStream(batch.slug, async noteStream => {
        this.logger.info('IMPORTING: Reading input stream into note logs', {
          micronoteBatch: batch.slug,
        });

        // NOTE: stream while inner transaction is still open
        await Note.importPgStream(client, noteStream);

        await wallet.load();

        if (wallet.balance < 0n) {
          throw new InsufficientFundsError(
            'The given changes would create a negative balance',
            wallet.balance.toString(),
          );
        }

        await new MicronoteBatchOutput(client, batchOutput).save();
      });
      // now update state
      await batch.recordStateTime('settledTime');
    }, transactionOptions);
  }

  private static async monitor(logQueries = true): Promise<void> {
    // load any open batches from the db
    await MainDb.transaction(
      async client => {
        // lock so multi-server setups don't create conflicting batches
        const ledgerWallet = new Wallet(client, config.nullAddress);
        await ledgerWallet.lock();

        const unsettledBatches = await MicronoteBatch.findUnsettled(client);
        unsettledBatches.forEach(MicronoteBatchManager.updateCached);
        await MicronoteBatchManager.createNewBatches();
      },
      { logQueries, logger: this.logger },
    );

    for (const pendingBatch of MicronoteBatchManager.pendingSettlementBatchesBySlug.values()) {
      if (pendingBatch.shouldClose) {
        await this.closeBatch(pendingBatch.address);
      }
      if (pendingBatch.shouldSettle) {
        await this.settleBatch(pendingBatch.address);
      }
    }
  }
}
