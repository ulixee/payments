import { WalletAlreadyRegisteredError, DuplicateError } from '../lib/errors';
import Wallet from '../models/Wallet';
import ApiHandler from '../lib/ApiHandler';

export default new ApiHandler('Wallet.register', {
  async handler(payload, options) {
    const { address, signature } = payload;
    this.validateAddressSignature(address, payload, signature);

    try {
      await Wallet.registerAddress(address, options.logger);
    } catch (err) {
      if (err instanceof DuplicateError) {
        throw new WalletAlreadyRegisteredError();
      }
      throw err;
    }

    return { success: true };
  },
});
