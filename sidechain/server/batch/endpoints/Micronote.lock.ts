import { MicronoteBatchClosedError } from '../../utils/errors';
import { ActiveBatches, bridgeToMain } from '..';
import Micronote from '../models/Micronote';
import ApiHandler from '../../utils/ApiHandler';
import BatchDb from '../db';
import MicronoteFunds from '../models/MicronoteFunds';
import { MicronoteBatchType } from '../../main/models/MicronoteBatch';

export default new ApiHandler('Micronote.lock', {
  async handler(payload, options) {
    const { identity, batchSlug, signature, id, addresses } = payload;
    this.validateIdentitySignature(identity, payload, signature);

    const batch = await ActiveBatches.get(batchSlug);
    if (batch.isClosed) {
      throw new MicronoteBatchClosedError();
    }

    const batchDb = BatchDb.get(batchSlug);
    const accepted = await batchDb.transaction(async client => {
      const micronote = new Micronote(client, null, id);
      await micronote.lockForIdentity(identity);

      if (addresses && batch.type === MicronoteBatchType.Credit) {
        await MicronoteFunds.verifyAllowedPaymentAddresses(
          client,
          micronote.data.fundsId,
          addresses,
        );
      }
      return true;
    }, options);
    const currentBlock = await bridgeToMain.currentBlock();

    return {
      accepted,
      // send back sidechain opinion for sanity check by worker
      currentBlockHeight: currentBlock.height,
      currentBlockHash: currentBlock.hash,
    };
  },
});
