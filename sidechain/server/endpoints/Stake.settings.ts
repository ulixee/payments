import config from '../config';
import ApiHandler from '../lib/ApiHandler';
import BlockManager from '../lib/BlockManager';

export default new ApiHandler('Stake.settings', {
  async handler() {
    const stableBlock = await BlockManager.getStableBlock();
    return {
      centagons: config.stakeSettings.currentCentagons,
      rootPublicKey: config.rootKey.publicKey,
      stakeAddress: config.stakeWallet.address,
      stableBlockHeight: stableBlock.height,
      stableBlockHash: stableBlock.blockHash,
      currentBlockHeight: await BlockManager.currentBlockHeight(),
      currentBlockHash: await BlockManager.currentBlockHash(),
      refundBlockWindow: config.stakeSettings.refundBlockWindow,
    };
  },
});
