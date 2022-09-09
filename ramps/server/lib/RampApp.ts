import PgPool, { DbType } from '@ulixee/payment-utils/pg/PgPool';
import ConsumerPriceIndexMonitor from './ConsumerPriceIndexMonitor';
import USDCMonitor from './USDCMonitor';
import RampLock from '../models/RampLock';
import config from '../config';
import AuditSchedule from './AuditSchedule';

export default class RampApp {
  static db = new PgPool<DbType.Ramp>(config.db.database, config.db);

  static async healthCheck(): Promise<void> {
    await RampApp.db.healthCheck();
  }

  static async start(): Promise<void> {
    await RampApp.db.healthCheck();
    await RampLock.init(config.neuteredHDWalletsForSales);
    await Promise.all([
      ConsumerPriceIndexMonitor.start(),
      USDCMonitor.start(),
      AuditSchedule.start(),
    ]);
  }

  static async stop(): Promise<void> {
    await Promise.all([ConsumerPriceIndexMonitor.stop(), USDCMonitor.stop(), AuditSchedule.stop()]);
    await RampApp.db.shutdown();
  }
}
