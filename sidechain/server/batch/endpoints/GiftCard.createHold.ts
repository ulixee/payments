import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer } from '@ulixee/commons/lib/bufferUtils';
import { InvalidSignatureError } from '@ulixee/crypto/lib/errors';
import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import { InsufficientFundsError, InvalidParameterError } from '@ulixee/payment-utils/lib/errors';
import GiftCards from '@ulixee/sidechain/lib/GiftCards';
import Ed25519 from '@ulixee/crypto/lib/Ed25519';
import GiftCard from '../models/GiftCard';
import BatchDb from '../db';
import { ActiveBatches } from '../index';
import MicronoteBatchType from '../../interfaces/MicronoteBatchType';

export default new ApiHandler('GiftCard.createHold', {
  async handler({ batchSlug, microgons, giftCardId, signature }, options) {
    const batch = await ActiveBatches.get(batchSlug);
    if (batch.type !== MicronoteBatchType.GiftCard) {
      throw new InvalidParameterError(
        "You're trying to create a hold for a gift card on a Micronote batch. Refresh the available batches with the Sidechain.openBatches API.",
      );
    }

    const batchDb = BatchDb.get(batchSlug);
    return await batchDb.transaction(async client => {
      const giftCard = new GiftCard(client, null, giftCardId);
      await giftCard.lock();
      const balance = await giftCard.getBalance();
      if (balance < microgons)
        throw new InsufficientFundsError(
          `This gift card doesn't have enough microgons remaining to support this hold amount (${microgons})`,
          `${balance}m`,
        );

      const keys = GiftCards.giftCardRedemptionKeyToKeypair(giftCard.data.redemptionKey);

      const message = sha3(
        concatAsBuffer(this.command, ':', batchSlug, giftCardId, microgons, keys.publicKey),
      );

      if (!Ed25519.verify(Ed25519.createPublicKeyFromBytes(keys.publicKey), message, signature)) {
        throw new InvalidSignatureError(
          "This gift card hold request was not correctly signed by it's redemption Key",
          `signature`,
        );
      }

      const hold = await giftCard.hold(microgons);
      return {
        holdId: hold.id,
        remainingBalance: balance,
      };
    }, options);
  },
});
