import { ISidechainApiTypes } from '@ulixee/specification/sidechain';
import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import MicronoteFunds from '../models/MicronoteFunds';
import BatchDb from '../db';

export default new ApiHandler('MicronoteBatch.activeFunds', {
  async handler({ address, batchSlug }, options) {
    const result: ISidechainApiTypes['MicronoteBatch.activeFunds']['result'] = [];

    const batchDb = BatchDb.get(batchSlug);
    await batchDb.transaction(async client => {
      const funds = await MicronoteFunds.findWithAddress(client, address);
      for (const fund of funds) {
        if (fund.microgons > fund.microgonsAllocated) {
          result.push({
            fundsId: fund.id,
            microgonsRemaining: fund.microgons - fund.microgonsAllocated,
            allowedRecipientAddresses: fund.allowedRecipientAddresses,
          });
        }
      }
    }, options);
    return result;
  },
});
