import { MicronoteBatchClosedError } from '@ulixee/payment-utils/lib/errors';
import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import { ActiveBatches, bridgeToMain } from '..';
import Micronote from '../models/Micronote';
import BatchDb from '../db';

export default new ApiHandler('Micronote.hold', {
  async handler(payload, options) {
    const { identity, batchSlug, signature, id, holdAuthorizationCode, microgons } = payload;
    this.validateIdentitySignature(identity, payload, signature);

    const batch = await ActiveBatches.get(batchSlug);
    if (batch.isClosed) {
      throw new MicronoteBatchClosedError();
    }

    const batchDb = BatchDb.get(batchSlug);
    let returnHoldAuthorizationCode: string;
    const holdResult = await batchDb.transaction(async client => {
      const micronote = new Micronote(client, null, id);
      if (holdAuthorizationCode) {
        await micronote.lock();
        if (micronote.data.finalizedTime) throw new Error('This micronote has already been finalized.');
        if (micronote.data.holdAuthorizationCode !== holdAuthorizationCode) {
          throw new Error('The provided holdAuthorizationCode is invalid for this Micronote.');
        }
      } else {
        await micronote.lockForIdentity(identity);
        if (micronote.data.finalizedTime) throw new Error('This micronote has already been finalized.');
        returnHoldAuthorizationCode = micronote.data.holdAuthorizationCode;
      }
      return await micronote.holdFunds(identity, microgons);
    }, options);

    const currentBlock = await bridgeToMain.currentBlock();

    return {
      ...holdResult,
      holdAuthorizationCode: returnHoldAuthorizationCode,
      // send back Sidechain perspective on block height for sanity check by worker
      currentBlockHeight: currentBlock.height,
      currentBlockHash: currentBlock.hash,
    };
  },
});
