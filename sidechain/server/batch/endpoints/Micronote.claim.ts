import { MicronoteBatchClosedError } from '../../utils/errors';
import Micronote from '../models/Micronote';
import ApiHandler from '../../utils/ApiHandler';
import BatchDb from '../db';
import { ActiveBatches } from '../index';

/**
 *
 * This request will be recorded to the micronoteBatch service
 * when a note is completed.
 *
 * Each worker payout is now specified
 *
 * Parameters:
 * - identity - the public key of this worker
 * - tokenAllocation - map of worker public key to microgons (including self)
 */

export default new ApiHandler('Micronote.claim', {
  async handler({ identity, tokenAllocation, id, batchSlug }, options) {
    const batch = await ActiveBatches.get(batchSlug);
    if (batch.isClosed) {
      throw new MicronoteBatchClosedError();
    }

    const batchDb = BatchDb.get(batchSlug);

    return await batchDb.transaction(async client => {
      const note = new Micronote(client, null, id);
      await note.claim(identity);
      await note.recordMicrogonsEarned(tokenAllocation);
      const finalCost = await note.returnChange(batch.address);
      return { finalCost };
    }, options);
  },
});
