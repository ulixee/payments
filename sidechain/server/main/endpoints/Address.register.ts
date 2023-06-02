import { DuplicateError } from '@ulixee/payment-utils/lib/errors';
import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import RegisteredAddress from '../models/RegisteredAddress';

export default new ApiHandler('Address.register', {
  async handler(payload, options) {
    const { address } = payload;

    try {
      await RegisteredAddress.register(address, options.logger);
    } catch (err) {
      if (err instanceof DuplicateError) {
        return { success: true };
      }
      throw err;
    }

    return { success: true };
  },
});
