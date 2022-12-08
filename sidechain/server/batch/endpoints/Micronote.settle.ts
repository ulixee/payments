import { MicronoteBatchClosedError } from '@ulixee/payment-utils/lib/errors';
import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import Micronote from '../models/Micronote';
import BatchDb from '../db';
import { ActiveBatches } from '../index';
import MicronoteFunds from '../models/MicronoteFunds';

export default new ApiHandler('Micronote.settle', {
  async handler({ identity, tokenAllocation, id, batchSlug, holdId, isFinal }, options) {
    const batch = await ActiveBatches.get(batchSlug);
    if (batch.isClosed) {
      throw new MicronoteBatchClosedError();
    }

    const batchDb = BatchDb.get(batchSlug);

    return await batchDb.transaction(async client => {
      const micronote = new Micronote(client, null, id);

      await micronote.load({ includeHolds: true, includeRecipients: true });
      if (micronote.data.finalizedTime)
        throw new Error('This micronote has already been finalized');
      if (isFinal) {
        if (micronote.data.lockedByIdentity !== identity) {
          throw new Error('This micronote can only be finalized by the initial holder.');
        }
        await micronote.markFinal(identity);
      }

      const finalAllocation: Record<string, number> = {};
      let totalCost = 0;
      for (const [address, microgons] of Object.entries(tokenAllocation)) {
        const value = Number(microgons);
        if (Number.isNaN(value) === true) continue;
        finalAllocation[address] = value;
        totalCost += value;
      }
      await micronote.recordMicrogonsEarned(holdId, identity, finalAllocation);

      await MicronoteFunds.verifyAllowedPaymentAddresses(
        client,
        micronote.data.fundsId,
        Object.keys(finalAllocation),
      );
      let finalCost = totalCost;
      if (isFinal) {
        finalCost = await micronote.returnChange(batch.address);
      }
      return { finalCost };
    }, options);
  },
});
