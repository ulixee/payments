import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import { InvalidParameterError } from '@ulixee/payment-utils/lib/errors';
import BatchDb from '../db';
import { ActiveBatches } from '../index';
import MicronoteBatchType from '../../interfaces/MicronoteBatchType';
import GiftCard from '../models/GiftCard';

export default new ApiHandler('GiftCard.settleHold', {
  async handler({ batchSlug, microgons, holdId, giftCardId }, options) {
    const batch = await ActiveBatches.get(batchSlug);
    if (batch.type !== MicronoteBatchType.GiftCard) {
      throw new InvalidParameterError(
        "You're trying to settle a gift card hold on a Micronote batch. Refresh the available batches with the Sidechain.openBatches API.",
      );
    }

    const batchDb = BatchDb.get(batchSlug);
    return await batchDb.transaction(async client => {
      const giftCard = new GiftCard(client, null, giftCardId);

      await giftCard.lock();
      const balance = await giftCard.getBalance();

      let didChargeFullBalance = true;
      if (microgons > giftCard.data.issuedMicrogons) {
        const hold = await giftCard.getHoldTransaction(holdId);
        const diff = microgons - hold.microgonsDebited;
        if (balance < diff) {
          didChargeFullBalance = false;
          microgons = hold.microgonsDebited + balance;
        }
      }
      await giftCard.settleHold(holdId, microgons);

      return {
        success: didChargeFullBalance,
        microgonsAllowed: microgons,
        giftCardBalance: balance,
      };
    }, options);
  },
});
