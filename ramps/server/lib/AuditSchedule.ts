import Logger from '@ulixee/commons/lib/Logger';
import moment = require('moment');
import SidechainClient from '@ulixee/sidechain/lib/SidechainClient';
import RampApp from './RampApp';
import RampLock from '../models/RampLock';
import RampAudit from '../models/RampAudit';
import config from '../config';
import ConsumerPriceIndex from '../models/ConsumerPriceIndex';
import ConsumerPriceIndexMonitor from './ConsumerPriceIndexMonitor';

const { log } = Logger(module);

export default class AuditSchedule {
  private static interval: NodeJS.Timer;
  private static isStopping = false;
  private static lockId = 'audits';
  private static isStartingPromise: Promise<void>;
  private static logger = log.createChild(module);

  public static start(): Promise<void> {
    if (this.isStartingPromise) return this.isStartingPromise;
    this.isStartingPromise = this.startInternal();
  }

  public static stop(): Promise<void> {
    this.isStopping = true;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    return Promise.resolve();
  }

  protected static async startInternal(): Promise<void> {
    this.interval = setInterval(() => this.runInterval(), 60 * 60e3).unref();
    await RampApp.db.transaction(db => RampLock.create(db, this.lockId));
    await this.runInterval();
  }

  protected static async runInterval(): Promise<void> {
    const opts = { logger: this.logger };
    await ConsumerPriceIndexMonitor.start();
    await RampApp.db.transaction(async client => {
      await RampLock.lock(client, this.lockId);
      const latest = await RampAudit.latestAudit(client);
      if (latest && moment().diff(latest.auditDate, 'days', true) < 7) {
        return;
      }
      const latestAudit = await new SidechainClient(config.sidechainHost, {}).getAudit();
      const latestCpi = await ConsumerPriceIndex.getLatest(true);
      await RampAudit.createAudit(
        client,
        latestCpi.conversionRate,
        latestAudit.argonsInCirculation_e2,
      );
    }, opts);
  }
}
