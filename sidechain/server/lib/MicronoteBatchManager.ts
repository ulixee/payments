import Log from '@ulixee/commons/lib/Logger';
import * as moment from 'moment';
import config from '../config';
import Wallet from '../models/Wallet';
import MicronoteBatch from '../models/MicronoteBatch';
import MicronoteBatchDb from "./MicronoteBatchDb";
import db from "./defaultDb";
import { NotFoundError } from './errors';
import MicronoteBatchClose from './MicronoteBatch.close';
import MicronoteBatchSettle from './MicronoteBatch.settle';

const { log } = Log(module);

export default class MicronoteBatchManager {
  private static logger = log.createChild(module, { action: 'MicronoteBatchManager' });
  private static openBatches = new Map<string, MicronoteBatch>();
  private static batchesPendingSettlement = new Map<string, MicronoteBatch>();
  private static refreshInterval: NodeJS.Timeout;

  public static getOpenBatchAddresses(): string[] {
    return [...this.openBatches.values()].map(x => x.address);
  }

  public static getOpenBatches(): MicronoteBatch[] {
    return [...this.openBatches.values()];
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
      await db.transaction(
        async client => {
          const batch = await MicronoteBatch.create(client);
          await MicronoteBatchDb.createDb(batch.slug, this.logger);
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
      const batch = [...this.openBatches.values()].sort((a, b) => {
        const timeA = a.data.openTime.getTime();
        const timeB = b.data.openTime.getTime();
        return timeB - timeA;
      });
      if (batch.length) {
        batchSlug = batch.shift().slug;
      }
    }

    if (MicronoteBatchManager.batchesPendingSettlement.has(batchSlug)) {
      return MicronoteBatchManager.batchesPendingSettlement.get(batchSlug);
    }

    if (MicronoteBatchManager.openBatches.has(batchSlug)) {
      return MicronoteBatchManager.openBatches.get(batchSlug);
    }

    throw new NotFoundError('Batch unavailable', batchSlug);
  }

  private static countNewBatchesNeeded(): number {
    const openForGreaterThan2MoreHours = [...this.openBatches.values()].filter(
      x => moment(x.data.stopNewNotesTime).diff(moment(), 'hours', true) > 2,
    );

    return config.micronoteBatch.minimumOpen - openForGreaterThan2MoreHours.length;
  }

  private static updateCached(batch: MicronoteBatch): void {
    // record cache
    if (batch.isSettled) {
      MicronoteBatchManager.openBatches.delete(batch.slug);
      MicronoteBatchManager.batchesPendingSettlement.delete(batch.slug);
    } else if (batch.isAllowingNewNotes === false) {
      MicronoteBatchManager.openBatches.delete(batch.slug);
      MicronoteBatchManager.batchesPendingSettlement.set(batch.slug, batch);
    } else {
      // still open
      MicronoteBatchManager.openBatches.set(batch.slug, batch);
    }
  }

  private static async monitor(logQueries = true): Promise<void> {
    // load any open batches from the db
    await db.transaction(
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

    for (const batch of MicronoteBatchManager.batchesPendingSettlement.values()) {
      if (batch.shouldClose) {
        await MicronoteBatchClose.run(batch, this.logger);
      }
      if (batch.shouldSettle) {
        await MicronoteBatchSettle.run(batch, this.logger);
      }
    }
  }
}
