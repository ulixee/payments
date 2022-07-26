import { MicronoteBatchClosedError } from '../lib/errors';
import MicronoteBatchManager from '../lib/MicronoteBatchManager';
import Micronote from '../models/Micronote';
import ApiHandler from '../lib/ApiHandler';
import MicronoteBatchDb from '../lib/MicronoteBatchDb';

/**
 *
 * This request will be recorded to the micronoteBatch service
 * when a note is completed.
 *
 * Each worker payout is now specified
 *
 * Parameters:
 * - publicKey - the public key of this worker
 * - tokenAllocation - map of worker public key to microgons (including self)
 */

export default new ApiHandler('Micronote.claim', {
  async handler({ publicKey, tokenAllocation, id, batchSlug }, options) {
    const batch = await MicronoteBatchManager.get(batchSlug);
    if (batch.isClosed) {
      throw new MicronoteBatchClosedError();
    }

    const db = await MicronoteBatchDb.get(batchSlug);

    let finalCost = 0;
    await db.transaction(async client => {
      const note = new Micronote(client, null, id);
      await note.claim(publicKey);
      await note.recordMicrogonsEarned(tokenAllocation);
      finalCost = await note.returnChange(batch);
    }, options);

    return {
      finalCost,
    };
  },
});
