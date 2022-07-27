import config from '../config';
import BlockManager from '../lib/BlockManager';
import Stake from '../models/Stake';
import db from '../lib/defaultDb';
import ApiHandler from '../lib/ApiHandler';

export default new ApiHandler('Stake.signature', {
  async handler(payload, options) {
    const { signature, stakedIdentity } = payload;

    this.validatedDigitalSignature(stakedIdentity, payload, signature);

    const blockHeight = await BlockManager.currentBlockHeight();

    const stake = await db.transaction(client => Stake.lock(client, stakedIdentity), options);
    const stakeSignedByRootIdentity = config.rootIdentity.sign(stake.createHash(blockHeight));

    return {
      blockHeight,
      signature: stakeSignedByRootIdentity,
      rootIdentity: config.rootIdentity.bech32,
    };
  },
});