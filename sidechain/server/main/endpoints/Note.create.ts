import { NoteType } from '@ulixee/specification';
import config from '../../config';
import { InvalidParameterError } from '../../utils/errors';
import RegisteredAddress from '../models/RegisteredAddress';
import Note from '../models/Note';
import MainDb from '../db';
import ApiHandler from '../../utils/ApiHandler';

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
      throw new InvalidParameterError('Cannot specify the guaranteeBlockHeight', 'guaranteeBlockHeight')
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
      const wallet = new RegisteredAddress(client, fromAddress);
      await wallet.lock();
      await wallet.load();

      await new Note(client, note).save(wallet);
      return {
        accepted: true,
      };
    }, options);
  },
});