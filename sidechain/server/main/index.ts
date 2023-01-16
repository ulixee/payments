import MainDb from './db';
import MicronoteBatchManager from './lib/MicronoteBatchManager';
import BlockManager from './lib/BlockManager';

export default class SidechainMain {
  static async healthCheck(): Promise<void> {
    await MainDb.healthCheck();
  }

  static async start(): Promise<void> {
    await MainDb.healthCheck();
    await BlockManager.start();
    await MicronoteBatchManager.start();
  }

  static async info(): Promise<any> {
    return {
      micronoteBatches: MicronoteBatchManager.getOpenBatches().map(batch => batch.getNoteParams()),
      blockSettings: await BlockManager.settings,
    };
  }

  static async stop(): Promise<void> {
    await MicronoteBatchManager.stop();
    await BlockManager.stop();
    await MainDb.shutdown();
  }
}
