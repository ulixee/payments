import { MicronoteBatchClosedError } from '@ulixee/payment-utils/lib/errors';
import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import Micronote from '../models/Micronote';
import BatchDb from '../db';
import { ActiveBatches } from '../index';
import MicronoteBatchType from '../../interfaces/MicronoteBatchType';
import MicronoteFunds from '../models/MicronoteFunds';

/**
 *
 * This request will be recorded to the micronoteBatch service
 * when a note is completed.
 *
 * Parameters:
 * - identity - the identity of the claimer (must match locking identity)
 * - tokenAllocation - map of payment addresses to microgons (including self)
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

      if (batch.type === MicronoteBatchType.GiftCard) {
        await MicronoteFunds.verifyAllowedPaymentAddresses(
          client,
          note.data.fundsId,
          Object.keys(tokenAllocation),
        );
      }
      const finalCost = await note.returnChange(batch.address);
      return { finalCost };
    }, options);
  },
});
