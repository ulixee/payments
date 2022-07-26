import config from '../config';
import BlockManager from '../lib/BlockManager';
import Stake from '../models/Stake';
import db from '../lib/defaultDb';
import ApiHandler from '../lib/ApiHandler';

export default new ApiHandler('Stake.signature', {
  async handler(payload, options) {
    const { signature, stakedPublicKey } = payload;

    this.validatedDigitalSignature(stakedPublicKey, payload, signature);

    const blockHeight = await BlockManager.currentBlockHeight();

    const stake = await db.transaction(client => Stake.lock(client, stakedPublicKey), options);
    const stakeSignedByRootKey = config.rootKey.sign(stake.createHash(blockHeight));

    return {
      blockHeight,
      signature: stakeSignedByRootKey,
      rootPublicKey: config.rootKey.publicKey,
    };
  },
});
