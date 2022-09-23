import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import RegisteredAddress from '../models/RegisteredAddress';
import MainDb from '../db';

export default new ApiHandler('Address.getBalance', {
  async handler({ address }, options) {
    return await MainDb.transaction(async client => {
      const balance = await RegisteredAddress.getBalance(client, address);

      return { balance };
    }, options);
  },
});
