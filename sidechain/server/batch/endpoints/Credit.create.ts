import Address from '@ulixee/crypto/lib/Address';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer } from '@ulixee/commons/lib/bufferUtils';
import { InvalidSignatureError } from '@ulixee/crypto/lib/errors';
import Credit from '../models/Credit';
import ApiHandler from '../../utils/ApiHandler';
import BatchDb from '../db';
import { ActiveBatches } from '../index';
import { InvalidParameterError } from '../../utils/errors';
import { MicronoteBatchType } from '../../main/models/MicronoteBatch';

export default new ApiHandler('Credit.create', {
  async handler(
    { batchSlug, microgons, allowedRecipientAddresses, allowedRecipientSignatures },
    options,
  ) {
    const batch = await ActiveBatches.get(batchSlug);
    if (batch.type !== MicronoteBatchType.Credit) {
      throw new InvalidParameterError(
        "You're trying to create a Credit on a non-credit batch. Refresh the available batches with the MicronoteBatch.get API.",
      );
    }

    const message = sha3(
      concatAsBuffer('Credit.Create:', batchSlug, microgons, ...allowedRecipientAddresses),
    );

    for (let i = 0; i < allowedRecipientAddresses.length; i += 1) {
      const address = allowedRecipientAddresses[i];
      const signature = allowedRecipientSignatures[i];
      if (!signature) {
        throw new InvalidParameterError(
          'A Credit address is missing from the signatures list. All parties must sign this credit.',
          `signatures[${i}]`,
        );
      }

      if (!Address.verify(address, message, signature))
        throw new InvalidSignatureError(
          'This Credit was not correctly signed by all the addresses',
          `addresses[${i}]`,
        );
    }

    const batchDb = BatchDb.get(batchSlug);
    return await batchDb.transaction(async client => {
      const credit = new Credit(client);

      const result = await credit.create({
        microgons,
        allowedRecipientAddresses,
        allowedRecipientSignatures,
      });

      const batchDetails = batch.getNoteParams();
      return {
        creditId: result.data.id,
        sidechainIdentity: batchDetails.sidechainIdentity,
        sidechainValidationSignature: batchDetails.sidechainValidationSignature,
      };
    }, options);
  },
});
