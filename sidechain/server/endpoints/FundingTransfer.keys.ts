import config from '../config';
import ApiHandler from '../lib/ApiHandler';

export default new ApiHandler('FundingTransfer.keys', {
  handler() {
    return Promise.resolve({
      transferOutKey: config.mainchain.addresses[0].bech32,
      transferInKeys: config.mainchain.addresses.map(x => x.bech32),
    });
  },
});
