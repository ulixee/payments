import { WalletAlreadyRegisteredError, DuplicateError } from '../../utils/errors';
import RegisteredAddress from '../models/RegisteredAddress';
import ApiHandler from '../../utils/ApiHandler';

export default new ApiHandler('Address.register', {
  async handler(payload, options) {
    const { address, signature } = payload;
    this.validateAddressSignature(address, payload, signature);

    try {
      await RegisteredAddress.register(address, options.logger);
    } catch (err) {
      if (err instanceof DuplicateError) {
        throw new WalletAlreadyRegisteredError();
      }
      throw err;
    }

    return { success: true };
  },
});
