import MainDb from './db';
import MicronoteBatchManager from './lib/MicronoteBatchManager';
import BlockManager from './lib/BlockManager';
import ConsumerPriceIndexMonitor from './lib/ConsumerPriceIndexMonitor';

export default class SidechainMain {
  static async healthCheck(): Promise<void> {
    await MainDb.healthCheck();
  }

  static async start(): Promise<void> {
    await MainDb.healthCheck();
    await BlockManager.start();
    await MicronoteBatchManager.start();
    await ConsumerPriceIndexMonitor.start();
  }

  static async stop(): Promise<void> {
    await MicronoteBatchManager.stop();
    await BlockManager.stop();
    await ConsumerPriceIndexMonitor.stop();
    await MainDb.shutdown();
  }
}
