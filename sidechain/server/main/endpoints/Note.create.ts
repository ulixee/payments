import { NoteType } from '@ulixee/specification';
import { InvalidParameterError } from '@ulixee/payment-utils/lib/errors';
import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import config from '../../config';
import RegisteredAddress from '../models/RegisteredAddress';
import Note from '../models/Note';
import MainDb from '../db';

;

export default new ApiHandler('Note.create', {
  async handler({ note }, options) {
    const { fromAddress, type } = note;

    if (type !== NoteType.transfer) {
      throw new InvalidParameterError(
        '"transfer" is currently the only allowed Note type for this api call',
        'type',
      );
    }

    if (note.guaranteeBlockHeight) {
      throw new InvalidParameterError('Cannot specify the guaranteeBlockHeight', 'guaranteeBlockHeight');
    }

    if (
      note.toAddress === config.rootIdentity.bech32 ||
      note.toAddress === config.stakeAddress.bech32 ||
      note.toAddress === config.nullAddress
    ) {
      throw new InvalidParameterError(
        'Direct transfers to the root public key are not allowed',
        'toAddress',
      );
    }

    return await MainDb.transaction(async client => {
      const address = new RegisteredAddress(client, fromAddress);
      await address.lock();
      await address.load();

      await new Note(client, note).save(address);
      return {
        accepted: true,
      };
    }, options);
  },
});
