import { NoteType } from '@ulixee/specification';
import config from '../config';
import { InvalidParameterError } from '../lib/errors';
import Wallet from '../models/Wallet';
import Note from '../models/Note';
import db from '../lib/defaultDb';
import ApiHandler from '../lib/ApiHandler';

export default new ApiHandler('Note.create', {
  async handler({ note }, options) {
    const { fromAddress, type } = note;

    if (type !== NoteType.transfer) {
      throw new InvalidParameterError(
        '"transfer" is currently the only allowed Note type for this api call',
        'type',
      );
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

    return await db.transaction(async client => {
      const wallet = new Wallet(client, fromAddress);
      await wallet.lock();
      await wallet.load();

      await new Note(client, note).save(wallet);
      return {
        accepted: true,
      };
    }, options);
  },
});
