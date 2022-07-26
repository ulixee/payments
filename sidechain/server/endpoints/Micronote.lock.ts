import BlockManager from '../lib/BlockManager';
import { MicronoteBatchClosedError } from '../lib/errors';
import MicronoteBatchManager from '../lib/MicronoteBatchManager';
import Micronote from '../models/Micronote';
import ApiHandler from '../lib/ApiHandler';
import MicronoteBatchDb from '../lib/MicronoteBatchDb';

export default new ApiHandler('Micronote.lock', {
  async handler(payload, options) {
    const { publicKey, batchSlug, signature, id } = payload;
    this.validatedDigitalSignature(publicKey, payload, signature);

    const batch = await MicronoteBatchManager.get(batchSlug);
    if (batch.isClosed) {
      throw new MicronoteBatchClosedError();
    }

    const db = await MicronoteBatchDb.get(batchSlug);
    const accepted = await db.transaction(
      client => new Micronote(client, null, id).lockForPublicKey(publicKey),
      options,
    );

    return {
      accepted,
      // send back sidechain opinion for sanity check by worker
      currentBlockHeight: await BlockManager.currentBlockHeight(),
      currentBlockHash: await BlockManager.currentBlockHash(),
    };
  },
});
