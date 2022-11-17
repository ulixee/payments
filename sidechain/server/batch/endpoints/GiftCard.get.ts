import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import { InvalidParameterError } from '@ulixee/payment-utils/lib/errors';
import GiftCard from '../models/GiftCard';
import BatchDb from '../db';
import { ActiveBatches } from '../index';
import MicronoteBatchType from '../../interfaces/MicronoteBatchType';

export default new ApiHandler('GiftCard.get', {
  async handler({ batchSlug, giftCardId }, options) {
    const batch = await ActiveBatches.get(batchSlug);
    if (batch.type !== MicronoteBatchType.GiftCard) {
      throw new InvalidParameterError(
        "You're trying to get a gift card on a Micronote batch. Refresh the available batches with the Sidechain.openBatches API.",
      );
    }

    const batchDb = BatchDb.get(batchSlug);
    return await batchDb.transaction(async client => {
      const giftCard = new GiftCard(client, null, giftCardId);
      const { id, issuerIdentities } = await giftCard.load();
      const balance = await giftCard.getBalance();

      return {
        id,
        balance,
        issuerIdentities,
      };
    }, options);
  },
});
