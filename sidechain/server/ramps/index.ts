import USDCMonitor from './lib/USDCMonitor';
import RampDb, { setup } from './db';
import config from '../config';

export default class Ramps {
  static async start(): Promise<void> {
    await setup(config.ramp.neuteredHDWalletsForSales);
    await USDCMonitor.start();
  }

  static async stop(): Promise<void> {
    await USDCMonitor.stop();
    await RampDb.shutdown();
  }
}
