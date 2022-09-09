import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer } from '@ulixee/commons/lib/bufferUtils';
import { NewNotesNotBeingAcceptedError } from '@ulixee/payment-utils/lib/errors';
import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import Micronote from '../models/Micronote';
import MicronoteFunds from '../models/MicronoteFunds';
import BatchDb from '../db';
import { ActiveBatches, bridgeToMain } from '../index';

/**
 * POST: /micronote
 *  1) creates a new micronote
 *  2) allocates money to the note
 *  3) public ledger pre-allocates its split of money and allocates rest to a new bucket
 *  4) returns the note money bucket public key
 *
 *  Parameters:
 *  - identity: public key of requesting client
 *  - microgons: amount this note is authorized to use of the given token
 *  - fundsId: optional preferred micronoteBatch id to use. Server will locate one if not provided
 */
export default new ApiHandler('Micronote.create', {
  async handler(payload, options) {
    const { address, fundsId, batchSlug, signature, isAuditable, microgons } = payload;
    this.validateAddressSignature(address, payload, signature);

    const batch = await ActiveBatches.get(batchSlug);
    if (!batch.isAllowingNewNotes) {
      throw new NewNotesNotBeingAcceptedError();
    }
    const blockHeight = (await bridgeToMain.currentBlock()).height;

    const batchDb = BatchDb.get(batchSlug);
    const micronote = await batchDb.transaction(async client => {
      const funds = new MicronoteFunds(client, batch.address, address);
      await funds.lockClient();
      const { guaranteeBlockHeight, microgonsRemaining } = await funds.holdTokens(
        fundsId,
        microgons,
      );

      const microNote = new Micronote(client, address);
      const micronoteRecord = await microNote.create(
        batch.address,
        fundsId,
        microgons,
        blockHeight,
        isAuditable,
      );

      return {
        id: micronoteRecord.id,
        fundsId,
        guaranteeBlockHeight,
        fundMicrogonsRemaining: microgonsRemaining,
      };
    }, options);

    const micronoteSignature = batch.credentials.identity.sign(
      sha3(concatAsBuffer(micronote.id, microgons)),
    );

    return {
      ...micronote,
      blockHeight,
      micronoteSignature,
    };
  },
});
