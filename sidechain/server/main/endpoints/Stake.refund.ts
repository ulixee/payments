import { NoteType } from '@ulixee/specification';
import config from '../../config';
import { NotFoundError } from '../../utils/errors';
import Note from '../models/Note';
import Stake from '../models/Stake';
import MainDb from '../db';
import ApiHandler from '../../utils/ApiHandler';

export default new ApiHandler('Stake.refund', {
  async handler(payload, options) {
    const { address, signature, stakedIdentity } = payload;
    await this.validateAddressSignature(address, payload, signature);

    return await MainDb.transaction(async client => {
      const stake = await Stake.lock(client, stakedIdentity);
      if (!stake) {
        throw new NotFoundError('No open stake found to refund');
      }

      const originalTx = await Note.load(stake.data.noteHash, options.logger);

      // create refund note
      const noteData = Note.addSignature(
        {
          fromAddress: config.stakeAddress.bech32,
          toAddress: stake.data.address,
          centagons: originalTx.data.centagons,
          effectiveBlockHeight: config.stakeSettings.refundBlockWindow, // money isn't good until eat stake window closes
          type: NoteType.stakeRefund,
        },
        config.stakeAddress,
      );
      const refund = new Note(client, noteData);
      await refund.saveUnchecked();

      const stakeHistory = await stake.refund(refund.data.noteHash);

      return {
        refundNoteHash: refund.data.noteHash,
        refundEffectiveHeight: refund.data.effectiveBlockHeight,
        blockEndHeight: stakeHistory.blockEndHeight,
      };
    }, options);
  },
});
