import { pickRandom } from '@ulixee/commons/lib/utils';
import moment = require('moment');
import ApiHandler from '../../utils/ApiHandler';
import RampDb from '../db';
import USDCAddress from '../models/USDCAddress';
import config from '../../config';
import USDCApi from '../lib/USDCApi';

export default new ApiHandler('Ramp.createTransferInAddress', {
  async handler({ address, blockchain }, options) {
    const rootWallets = config.ramp.neuteredHDWalletsForSales.filter(
      x => x.meta.blockchain === blockchain,
    );
    if (!rootWallets.length)
      throw new Error('No supported wallets found for the requested blockchain');

    const rootWallet = pickRandom(rootWallets);
    const currentBlock = await USDCApi.fromWallet(rootWallet).currentBlockNumber();

    return await RampDb.transaction(async client => {
      const expirationDate = moment()
        .add(config.ramp.transferInAddressExpirationHours, 'hours')
        .toDate();

      const hdWallet = await USDCAddress.allocate(
        client,
        address,
        currentBlock,
        expirationDate,
        rootWallet,
      );
      return {
        blockchainNetwork: hdWallet.meta.blockchainNetwork,
        address: hdWallet.address,
        expirationDate,
      };
    }, options);
  },
});
