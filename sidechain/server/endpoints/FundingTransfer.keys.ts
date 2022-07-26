import config from '../config';
import ApiHandler from '../lib/ApiHandler';

export default new ApiHandler('FundingTransfer.keys', {
  handler() {
    return Promise.resolve({
      transferOutKey: config.mainchain.wallets[0].address,
      transferInKeys: config.mainchain.wallets.map(x => x.address),
    });
  },
});
