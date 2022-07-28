import Wallet from '../models/Wallet';
import ApiHandler from '../../utils/ApiHandler';
import MainDb from '../db';

export default new ApiHandler('Wallet.getBalance', {
  async handler({ address }, options) {
    return await MainDb.transaction(async client => {
      const balance = await Wallet.getBalance(client, address);

      return { balance };
    }, options);
  },
});
