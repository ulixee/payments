import ArgonUtils from '@ulixee/sidechain/lib/ArgonUtils';
import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import { NotFoundError } from '@ulixee/payment-utils/lib/errors';
import MicronoteFunds from '../models/MicronoteFunds';
import BatchDb from '../db';
import { ActiveBatches } from '../index';

/**
 * Get the final settlement state of a micronote batch if not finalized yet
 */
export default new ApiHandler('MicronoteBatch.getFundSettlement', {
  async handler({ batchSlug, fundIds }, options) {
    const batch = await ActiveBatches.get(batchSlug);
    const batchDb = BatchDb.get(batch.slug, true);
    if (!batchDb) throw new NotFoundError('Micronote Batch not found');

    // need a new tx against the target db
    const funds = await batchDb.transaction(
      batchClient => MicronoteFunds.findWithIds(batchClient, fundIds),
      options,
    );
    return {
      isBatchSettled: batch.isSettled,
      settledTime: batch.settledTime,
      settlements: funds.map(x => ({
        fundsId: x.id,
        fundedCentagons: ArgonUtils.microgonsToCentagons(x.microgons, false),
        settledCentagons: ArgonUtils.microgonsToCentagons(x.microgonsAllocated, false),
      })),
    };
  },
});
