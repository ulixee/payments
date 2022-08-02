import Credit from '../models/Credit';
import ApiHandler from '../../utils/ApiHandler';
import BatchDb from '../db';
import { ActiveBatches, bridgeToMain } from '../index';
import { InvalidParameterError } from '../../utils/errors';
import { MicronoteBatchType } from '../../main/models/MicronoteBatch';
import MicronoteFunds from '../models/MicronoteFunds';

export default new ApiHandler('Credit.claim', {
  async handler({ batchSlug, creditId, address }, options) {
    const batch = await ActiveBatches.get(batchSlug);
    if (batch.type !== MicronoteBatchType.Credit) {
      throw new InvalidParameterError(
        "You're trying to claim a Credit on a non-credit batch. Contact the developer who granted you this credit.",
      );
    }

    const currentBlock = await bridgeToMain.currentBlock();

    const batchDb = BatchDb.get(batchSlug);
    return await batchDb.transaction(async client => {
      const credit = new Credit(client, null, creditId);

      await credit.lock();
      if (credit.data.claimAddress) throw new Error('This Credit has already been claimed');

      await credit.claim(address);
      if (!credit.data.fundsId) {
        await new MicronoteFunds(client, batch.address, address).createLock();
        const fund = await MicronoteFunds.createFromCredit(
          client,
          credit.data,
          currentBlock.height,
        );
        await credit.saveFund(fund.id);
      }

      return {
        fundsId: credit.data.fundsId,
        microgons: credit.data.microgons,
        allowedRecipientAddresses: credit.data.allowedRecipientAddresses,
      };
    }, options);
  },
});
