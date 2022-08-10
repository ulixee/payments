import {
  InvalidParameterError,
  MicronoteBatchClosedError,
  NewNotesNotBeingAcceptedError,
} from '../../utils/errors';
import { ActiveBatches, bridgeToMain } from '..';
import MicronoteFunds from '../models/MicronoteFunds';
import ApiHandler from '../../utils/ApiHandler';
import BatchDb from '../db';
import { MicronoteBatchType } from '../../main/models/MicronoteBatch';

/**
 * An micronote batch service will register with the central ledger on boot.
 *
 * Micronote batches last 8 hours (configurable) and then close and do not accept any more notes
 *
 */
export default new ApiHandler('MicronoteBatch.fund', {
  async handler({ batchSlug, note }, options) {
    const batch = await ActiveBatches.get(batchSlug);
    if (batch.isClosed) {
      throw new MicronoteBatchClosedError();
    }
    if (batch.isAllowingNewNotes === false) {
      throw new NewNotesNotBeingAcceptedError();
    }

    if (batch.type === MicronoteBatchType.GiftCard) {
      throw new InvalidParameterError(
        "You're trying to fund a gift card batch with a Note. You need to use a Micronote batch.",
        'batchSlug',
      );
    }

    const batchDb = BatchDb.get(batchSlug);

    const currentBlock = await bridgeToMain.currentBlock();
    let blockHeight = currentBlock.height;
    if (blockHeight < note.effectiveBlockHeight) {
      blockHeight = note.effectiveBlockHeight;
    }

    const { id: fundsId } = await bridgeToMain.saveNote(
      note,
      noteRecord => {
        return batchDb.transaction(async batchClient => {
          const funding = new MicronoteFunds(batchClient, batch.address, noteRecord.fromAddress);
          await funding.createLock();
          // validates "toAddress" corresponds to this batch
          return funding.createFromNote(noteRecord);
        }, options);
      },
      options,
    );

    return {
      fundsId,
    };
  },
});
