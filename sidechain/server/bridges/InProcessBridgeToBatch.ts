import IBridgeToBatch from '../interfaces/IBridgeToBatch';
import BatchDb from '../batch/db';
import MicronoteBatchClose from '../batch/models/MicronoteBatch.close';
import MicronoteBatchSettle from '../batch/models/MicronoteBatch.settle';
import { IMicronoteBatchOutputRecord } from '../main/models/MicronoteBatchOutput';
import { ActiveBatches } from '../batch';

const InProcessBridgeToBatch: IBridgeToBatch = {
  async closeBatch(batchSlug, batchBalance, noteHashes, opts): Promise<void> {
    const batchDb = BatchDb.get(batchSlug);
    const batch = ActiveBatches.get(batchSlug);
    await batchDb.transaction(async batchClient => {
      const batchCloser = new MicronoteBatchClose(
        batchClient,
        batch.credentials.address,
        batchBalance,
        noteHashes,
      );
      await batchCloser.run();
    }, opts);
  },
  async getBatchOutputStream(batchSlug, onComplete): Promise<void> {
    await BatchDb.get(batchSlug).transaction(async client => {
      const stream = MicronoteBatchSettle.noteOutputStream(client);
      await onComplete(stream);
    });
  },
  async getBatchSummary(batchSlug): Promise<IMicronoteBatchOutputRecord> {
    return await MicronoteBatchSettle.get(batchSlug);
  },
  async closeDbs(): Promise<void> {
    await BatchDb.close();
  },
};
export default InProcessBridgeToBatch;
