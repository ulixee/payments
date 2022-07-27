import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer } from '@ulixee/commons/lib/bufferUtils';
import { NewNotesNotBeingAcceptedError } from '../lib/errors';
import MicronoteBatchManager from '../lib/MicronoteBatchManager';
import Micronote from '../models/Micronote';
import MicronoteFunds from '../models/MicronoteFunds';
import ApiHandler from '../lib/ApiHandler';
import MicronoteBatchDb from '../lib/MicronoteBatchDb';

/**
 * POST: /note
 *  1) creates a new note
 *  2) allocates money to the note
 *  3) public ledger pre-allocates its split of money and allocates rest to a new bucket
 *  4) returns the note money bucket public key
 *
 *  Parameters:
 *  - identity: public key of requesting client
 *  - microgons: amount this note is authorized to use of the given token
 *  - fundsId: optional preferred micronoteBatch id to use.  Server will locate one if not provided
 */
export default new ApiHandler('Micronote.create', {
  async handler(payload, options) {
    const { address, fundsId, batchSlug, signature, isAuditable, microgons } = payload;
    this.validateAddressSignature(address, payload, signature);

    const batch = await MicronoteBatchManager.get(batchSlug);
    if (batch.isAllowingNewNotes === false) {
      throw new NewNotesNotBeingAcceptedError();
    }

    const batchDb = await MicronoteBatchDb.get(batchSlug);
    const micronote = await batchDb.transaction(async client => {
      const funds = new MicronoteFunds(client, batch, address);
      await funds.lockClient();
      const { guaranteeBlockHeight, microgonsRemaining } = await funds.holdTokens(
        fundsId,
        microgons,
      );

      const microNote = new Micronote(client, address);
      const micronoteRecord = await microNote.create(batch, fundsId, microgons, isAuditable);

      return {
        id: micronoteRecord.id,
        blockHeight: micronoteRecord.blockHeight,
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
      micronoteSignature,
    };
  },
});