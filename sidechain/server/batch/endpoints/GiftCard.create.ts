import Address from '@ulixee/crypto/lib/Address';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer } from '@ulixee/commons/lib/bufferUtils';
import { InvalidSignatureError } from '@ulixee/crypto/lib/errors';
import GiftCard from '../models/GiftCard';
import ApiHandler from '../../utils/ApiHandler';
import BatchDb from '../db';
import { ActiveBatches } from '../index';
import { InvalidParameterError } from '../../utils/errors';
import { MicronoteBatchType } from '../../main/models/MicronoteBatch';

export default new ApiHandler('GiftCard.create', {
  async handler(
    { batchSlug, microgons, redeemableWithAddresses, redeemableAddressSignatures },
    options,
  ) {
    const batch = await ActiveBatches.get(batchSlug);
    if (batch.type !== MicronoteBatchType.GiftCard) {
      throw new InvalidParameterError(
        "You're trying to create a gift card on a Micronote batch. Refresh the available batches with the MicronoteBatch.get API.",
      );
    }

    const message = sha3(
      concatAsBuffer('GiftCard.Create:', batchSlug, microgons, ...redeemableWithAddresses),
    );

    for (let i = 0; i < redeemableWithAddresses.length; i += 1) {
      const address = redeemableWithAddresses[i];
      const signature = redeemableAddressSignatures[i];
      if (!signature) {
        throw new InvalidParameterError(
          'An address is missing from the signatures list. All parties must sign this gift card.',
          `signatures[${i}]`,
        );
      }

      if (!Address.verify(address, message, signature))
        throw new InvalidSignatureError(
          'This gift card was not correctly signed by all the addresses',
          `addresses[${i}]`,
        );
    }

    const batchDb = BatchDb.get(batchSlug);
    return await batchDb.transaction(async client => {
      const giftCard = new GiftCard(client);

      const result = await giftCard.create({
        microgons,
        redeemableWithAddresses,
        redeemableAddressSignatures,
      });

      const batchDetails = batch.getNoteParams();
      return {
        giftCardId: result.data.id,
        sidechainIdentity: batchDetails.sidechainIdentity,
        sidechainValidationSignature: batchDetails.sidechainValidationSignature,
      };
    }, options);
  },
});
