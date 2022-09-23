import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import config from '../../config';
import BlockManager from '../lib/BlockManager';

export default new ApiHandler('Stake.settings', {
  async handler() {
    const stableBlock = await BlockManager.getStableBlock();
    return {
      centagons: config.stakeSettings.currentCentagons,
      rootIdentity: config.rootIdentity.bech32,
      stakeAddress: config.stakeAddress.bech32,
      stableBlockHeight: stableBlock.height,
      stableBlockHash: stableBlock.blockHash,
      currentBlockHeight: await BlockManager.currentBlockHeight(),
      currentBlockHash: await BlockManager.currentBlockHash(),
      refundBlockWindow: config.stakeSettings.refundBlockWindow,
    };
  },
});
