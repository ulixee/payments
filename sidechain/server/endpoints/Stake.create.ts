import config from '../config';
import BlockManager from '../lib/BlockManager';
import { InvalidParameterError, InvalidStakeTransactionRecipientError } from '../lib/errors';
import Wallet from '../models/Wallet';
import Note from '../models/Note';
import Stake from '../models/Stake';
import db from '../lib/defaultDb';
import ApiHandler from '../lib/ApiHandler';

export default new ApiHandler('Stake.create', {
  async handler({ note, stakedIdentity }, options) {
    const address = note.fromAddress;
    let blockHeight = await BlockManager.currentBlockHeight();
    if (blockHeight < note.effectiveBlockHeight) {
      blockHeight = note.effectiveBlockHeight;
    }

    if (note.toAddress !== config.stakeAddress.bech32) {
      throw new InvalidStakeTransactionRecipientError();
    }

    if (note.centagons !== config.stakeSettings.currentCentagons) {
      throw new InvalidParameterError('Invalid stake amount', 'centagons', {
        centagonsProposed: note.centagons,
        centagonsNeeded: config.stakeSettings.currentCentagons,
      });
    }

    const stake = await db.transaction(async client => {
      const wallet = new Wallet(client, address);
      await wallet.lock();
      await wallet.load();

      const noteRecord = new Note(client, note);
      await noteRecord.save(wallet);

      return await new Stake(client, {
        identity: stakedIdentity,
        address,
        noteHash: noteRecord.data.noteHash,
        blockStartHeight: blockHeight,
      }).save();
    }, options);

    const signatureMessage = stake.createHash(blockHeight);

    return {
      blockHeight,
      signature: config.rootIdentity.sign(signatureMessage),
      rootIdentity: config.rootIdentity.bech32,
    };
  },
});
