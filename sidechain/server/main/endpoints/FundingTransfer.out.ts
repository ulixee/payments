import { NoteType } from '@ulixee/specification';
import config from '../../config';
import BlockManager from '../lib/BlockManager';
import { InvalidParameterError, InvalidRecipientError } from '../../utils/errors';
import RegisteredAddress from '../models/RegisteredAddress';
import FundingTransferOut from '../models/FundingTransferOut';
import MainDb from '../db';
import ApiHandler from '../../utils/ApiHandler';
import Note from '../models/Note';

export default new ApiHandler('FundingTransfer.out', {
  async handler({ note }, options) {
    const identity = note.fromAddress;
    if (note.effectiveBlockHeight) {
      throw new InvalidParameterError('Transfers out cannot contain an effective block height');
    }

    if (!config.mainchain.addressesByBech32[note.toAddress]) {
      throw new InvalidRecipientError(
        'The output recipient is not a valid wallet owned by this sidechain',
      );
    }

    if (note.type !== NoteType.transferOut) {
      throw new InvalidParameterError('Transfer out note must have type of "transferOut"', 'type');
    }

    return await MainDb.transaction(async client => {
      const wallet = new RegisteredAddress(client, identity);
      await wallet.lock();
      await wallet.load();

      // validates signatures
      await new Note(client, note).save(wallet);

      // TODO: we might need to store the signature of the transfer out for extra proof
      await new FundingTransferOut(client, {
        noteHash: note.noteHash,
      }).save();

      return {
        noteHash: note.noteHash,
        currentBlockHash: (await BlockManager.settings).blockHash,
      };
    }, options);
  },
});
