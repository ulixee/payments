import MicronoteBatch from '../models/MicronoteBatch';
import MicronoteFunds from '../models/MicronoteFunds';
import db from '../lib/defaultDb';
import ApiHandler from '../lib/ApiHandler';
import MicronoteBatchDb from '../lib/MicronoteBatchDb';

/**
 * Get the final settlement state of a micronote batch if not finalized yet
 */
export default new ApiHandler('MicronoteBatch.getFundSettlement', {
  async handler({ batchAddress, fundIds }, options) {
    return await db.transaction(async client => {
      const batch = await MicronoteBatch.load(client, batchAddress);

      let micronoteBatchDb = await MicronoteBatchDb.get(batch.slug, true);

      let didCreate = false;
      try {
        if (!micronoteBatchDb) {
          micronoteBatchDb = await MicronoteBatchDb.createDb(batch.slug, options.logger);
          didCreate = true;
        }

        // need a new tx against the target db
        const funds = await micronoteBatchDb.transaction(
          batchClient => MicronoteFunds.find(batchClient, fundIds),
          options,
        );
        return {
          isBatchSettled: batch.isSettled,
          settleTime: batch.data.settledTime ? new Date() : null,
          settlements: funds.map(x => ({
            fundId: x.id,
            fundedCentagons: Math.ceil(x.microgons / 10e3),
            settledCentagons: Math.ceil(x.microgonsAllocated / 10e3),
          })),
        };
      } finally {
        if (didCreate) {
          await micronoteBatchDb.shutdown();
        }
      }
    }, options);
  },
});
