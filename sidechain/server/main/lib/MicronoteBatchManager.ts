import Log from '@ulixee/commons/lib/Logger';
import * as moment from 'moment';
import { NotFoundError , InsufficientFundsError } from '@ulixee/payment-utils/lib/errors';
import { ITransactionOptions } from '@ulixee/payment-utils/pg/PgPool';
import config from '../../config';
import RegisteredAddress from '../models/RegisteredAddress';
import MicronoteBatch from '../models/MicronoteBatch';
import BatchDb from '../../batch/db';
import MainDb from '../db';
import Note from '../models/Note';
import MicronoteBatchOutput from '../models/MicronoteBatchOutput';
import { BridgeToBatch } from '../../bridges';
import MicronoteBatchType from '../../interfaces/MicronoteBatchType';

const { log } = Log(module);

export default class MicronoteBatchManager {
  public static giftCardBatch: MicronoteBatch;

  private static logger = log.createChild(module, { action: 'MicronoteBatchManager' });
  private static batchesBySlug = new Map<string, MicronoteBatch>();
  private static refreshInterval: NodeJS.Timeout;

  public static getOpenBatches(): MicronoteBatch[] {
    return [...this.batchesBySlug.values()]
      .filter(x => x.isAllowingNewNotes)
      .sort((a, b) => {
        // newest first
        return b.plannedClosingTime.getTime() - a.plannedClosingTime.getTime();
      });
  }

  public static async stop(): Promise<void> {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    await BridgeToBatch.closeDbs();
  }

  public static async refresh(): Promise<void> {
    await this.monitor();
  }

  public static async start(): Promise<void> {
    if (!this.refreshInterval) {
      await this.monitor();
      // re-check micronoteBatch state every 5 seconds
      this.refreshInterval = setInterval(() => this.monitor(false), 5000).unref();
    }
  }

  public static async createNewBatches(): Promise<void> {
    let counterNeeded = this.countNewBatchesNeeded();

    while (counterNeeded > 0) {
      await MainDb.transaction(
        async client => {
          const batch = await MicronoteBatch.create(client, MicronoteBatchType.Micronote);

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

    if (!this.giftCardBatch) {
      await MainDb.transaction(
        async client => {
          const batch = await MicronoteBatch.create(client, MicronoteBatchType.GiftCard);

          const dbName = BatchDb.getName(batch.slug);
          await MainDb.query(`CREATE DATABASE ${dbName}`);

          await BatchDb.createDb(batch.slug, this.logger);
          this.updateCached(batch);
          this.logger.info('MicronoteGiftCards.open', {
            openTime: batch.data.openTime,
            slug: batch.slug,
          });
        },
        { logger: this.logger },
      );
    }
  }

  public static get(slug?: string): MicronoteBatch {
    if (slug === this.giftCardBatch?.slug) return this.giftCardBatch;

    let batchSlug = slug;

    // if no slug provided, find newest one
    if (!batchSlug) {
      const batch = [...this.batchesBySlug.values()].sort((a, b) => {
        const timeA = a.data.openTime.getTime();
        const timeB = b.data.openTime.getTime();
        return timeB - timeA;
      });
      if (batch.length) {
        batchSlug = batch.shift().slug;
      }
    }

    if (this.batchesBySlug.has(batchSlug)) {
      return this.batchesBySlug.get(batchSlug);
    }

    throw new NotFoundError('Batch unavailable', batchSlug);
  }

  private static async monitor(logQueries = true): Promise<void> {
    const txOptions = { logQueries, logger: this.logger };
    // load any open batches from the db
    await MainDb.transaction(async client => {
      // lock so multi-server setups don't create conflicting batches
      const ledgerWallet = new RegisteredAddress(client, config.nullAddress);
      await ledgerWallet.lock();

      const unsettledBatches = await MicronoteBatch.findUnsettled(client);
      for (const batch of unsettledBatches) this.updateCached(batch);
      await this.createNewBatches();
    }, txOptions);

    for (const pendingBatch of this.batchesBySlug.values()) {
      // do not settle or close giftCard batches
      if (pendingBatch.data.type === MicronoteBatchType.GiftCard) continue;

      if (pendingBatch.shouldClose) {
        await this.closeBatch(pendingBatch.address, txOptions);
      }
      if (pendingBatch.shouldSettle) {
        await this.settleBatch(pendingBatch.address, txOptions);
      }
    }
  }

  private static countNewBatchesNeeded(): number {
    const openForGreaterThan2MoreHours: MicronoteBatch[] = [];
    for (const batch of this.batchesBySlug.values()) {
      const hoursUntilStopping = moment(batch.data.stopNewNotesTime).diff(moment(), 'hours', true);
      if (hoursUntilStopping > 2) openForGreaterThan2MoreHours.push(batch);
    }

    return config.micronoteBatch.minimumOpen - openForGreaterThan2MoreHours.length;
  }

  private static updateCached(batch: MicronoteBatch): void {
    if (batch.data.type === MicronoteBatchType.GiftCard) {
      this.giftCardBatch = batch;
      return;
    }
    // record cache
    if (batch.isSettled) {
      this.batchesBySlug.delete(batch.slug);
    } else {
      // still open
      this.batchesBySlug.set(batch.slug, batch);
    }
  }

  private static closeBatch(
    batchAddress: string,
    transactionOptions: ITransactionOptions,
  ): Promise<void> {
    return MainDb.transaction(async client => {
      const batch = await MicronoteBatch.lock(client, batchAddress);
      // make sure not closed
      if (batch.isClosed) {
        this.logger.info('Not closing micronote batch. Already closed.');
        return;
      }
      const batchBalance = await RegisteredAddress.getBalance(client, batch.address);
      const noteHashes = await RegisteredAddress.getNoteHashes(client, batch.address);
      await BridgeToBatch.closeBatch(batch.slug, batchBalance, noteHashes, transactionOptions);
      await batch.recordStateTime('closedTime');
    }, transactionOptions);
  }

  private static async settleBatch(
    batchAddress: string,
    transactionOptions: ITransactionOptions,
  ): Promise<void> {
    // NOTE: funky transaction/loading matters here. Need to keep streams open and rollback appropriately
    await MainDb.transaction(async client => {
      // lock first
      const batch = await MicronoteBatch.lock(client, batchAddress);
      if (batch.isSettled) {
        client.logger.warn('Not settling micronoteBatch. Already settled.');
        return batch.data;
      }
      if (batch.data.type === MicronoteBatchType.GiftCard) {
        throw new Error(
          'Attempted to settle a gift card batch!! Gift card batches cannot write to the ledger.',
        );
      }

      // lock wallet on ledger
      const wallet = new RegisteredAddress(client, batch.address);
      await wallet.lock();

      const batchOutput = await BridgeToBatch.getBatchSummary(batch.slug);
      await BridgeToBatch.getBatchOutputStream(batch.slug, async noteStream => {
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
}
