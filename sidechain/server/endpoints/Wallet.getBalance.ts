import Wallet from '../models/Wallet';
import ApiHandler from '../lib/ApiHandler';
import defaultDb from '../lib/defaultDb';

export default new ApiHandler('Wallet.getBalance', {
  async handler({ address }, options) {
    return await defaultDb.transaction(async client => {
      const balance = await Wallet.getBalance(client, address);

      return { balance };
    }, options);
  },
});
