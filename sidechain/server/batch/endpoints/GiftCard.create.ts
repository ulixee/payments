import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer } from '@ulixee/commons/lib/bufferUtils';
import { InvalidSignatureError } from '@ulixee/crypto/lib/errors';
import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import { InvalidParameterError } from '@ulixee/payment-utils/lib/errors';
import Identity from '@ulixee/crypto/lib/Identity';
import GiftCard from '../models/GiftCard';
import BatchDb from '../db';
import { ActiveBatches } from '../index';
import MicronoteBatchType from '../../interfaces/MicronoteBatchType';

export default new ApiHandler('GiftCard.create', {
  async handler({ batchSlug, microgons, issuerIdentities, issuerSignatures }, options) {
    const batch = await ActiveBatches.get(batchSlug);
    if (batch.type !== MicronoteBatchType.GiftCard) {
      throw new InvalidParameterError(
        "You're trying to create a gift card on a Micronote batch. Refresh the available batches with the Sidechain.openBatches API.",
      );
    }

    const message = sha3(
      concatAsBuffer(this.command, ':', batchSlug, microgons, ...issuerIdentities),
    );

    for (let i = 0; i < issuerIdentities.length; i += 1) {
      const identity = issuerIdentities[i];
      const signature = issuerSignatures[i];
      if (!signature) {
        throw new InvalidParameterError(
          'An identity is missing from the signatures list. All parties must sign this gift card.',
          `signatures[${i}]`,
        );
      }

      if (!Identity.verify(identity, message, signature))
        throw new InvalidSignatureError(
          'This gift card was not correctly signed by all the identities',
          `identities[${i}]`,
        );
    }

    const batchDb = BatchDb.get(batchSlug);
    return await batchDb.transaction(async client => {
      const giftCard = new GiftCard(client);

      const result = await giftCard.create({
        issuedMicrogons: microgons,
        issuerIdentities,
        issuerSignatures,
      });

      return {
        giftCardId: result.data.id,
        redemptionKey: result.data.redemptionKey,
      };
    }, options);
  },
});
