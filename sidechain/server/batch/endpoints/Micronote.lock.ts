import { MicronoteBatchClosedError } from '../../utils/errors';
import { ActiveBatches, bridgeToMain } from '..';
import Micronote from '../models/Micronote';
import ApiHandler from '../../utils/ApiHandler';
import BatchDb from '../db';

export default new ApiHandler('Micronote.lock', {
  async handler(payload, options) {
    const { identity, batchSlug, signature, id } = payload;
    this.validatedDigitalSignature(identity, payload, signature);

    const batch = await ActiveBatches.get(batchSlug);
    if (batch.isClosed) {
      throw new MicronoteBatchClosedError();
    }

    const batchDb = BatchDb.get(batchSlug);
    const accepted = await batchDb.transaction(
      client => new Micronote(client, null, id).lockForIdentity(identity),
      options,
    );
    const currentBlock = await bridgeToMain.currentBlock();

    return {
      accepted,
      // send back sidechain opinion for sanity check by worker
      currentBlockHeight: currentBlock.height,
      currentBlockHash: currentBlock.hash,
    };
  },
});
