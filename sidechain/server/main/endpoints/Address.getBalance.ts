import RegisteredAddress from '../models/RegisteredAddress';
import ApiHandler from '../../utils/ApiHandler';
import MainDb from '../db';

export default new ApiHandler('Address.getBalance', {
  async handler({ address }, options) {
    return await MainDb.transaction(async client => {
      const balance = await RegisteredAddress.getBalance(client, address);

      return { balance };
    }, options);
  },
});
