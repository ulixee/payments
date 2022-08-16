import GiftCard from '../models/GiftCard';
import ApiHandler from '../../utils/ApiHandler';
import BatchDb from '../db';
import { ActiveBatches, bridgeToMain } from '../index';
import { InvalidParameterError } from '../../utils/errors';
import { MicronoteBatchType } from '../../main/models/MicronoteBatch';
import MicronoteFunds from '../models/MicronoteFunds';

export default new ApiHandler('GiftCard.claim', {
  async handler({ batchSlug, giftCardId, address }, options) {
    const batch = await ActiveBatches.get(batchSlug);
    if (batch.type !== MicronoteBatchType.GiftCard) {
      throw new InvalidParameterError(
        "You're trying to claim a gift card on a Micronote batch. Contact the developer who granted you this gift card.",
      );
    }

    const currentBlock = await bridgeToMain.currentBlock();

    const batchDb = BatchDb.get(batchSlug);
    return await batchDb.transaction(async client => {
      const giftCard = new GiftCard(client, null, giftCardId);

      await giftCard.lock();
      if (giftCard.data.claimAddress) throw new Error('This gift card has already been claimed');

      await giftCard.claim(address);
      if (!giftCard.data.fundsId) {
        await new MicronoteFunds(client, batch.address, address).createLock();
        const fund = await MicronoteFunds.createFromGiftCard(
          client,
          giftCard.data,
          currentBlock.height,
        );
        await giftCard.saveFund(fund.id);
      }

      return {
        fundsId: giftCard.data.fundsId,
        microgons: giftCard.data.microgons,
        redeemableWithAddresses: giftCard.data.redeemableWithAddresses,
      };
    }, options);
  },
});
