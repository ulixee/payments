import BlockManager from '../lib/BlockManager';
import { MicronoteBatchClosedError, NewNotesNotBeingAcceptedError } from '../lib/errors';
import MicronoteBatchManager from '../lib/MicronoteBatchManager';
import Wallet from '../models/Wallet';
import MicronoteFunds from '../models/MicronoteFunds';
import Note from '../models/Note';
import db from '../lib/defaultDb';
import ApiHandler from '../lib/ApiHandler';
import MicronoteBatchDb from '../lib/MicronoteBatchDb';

/**
 * An micronote batch service will register with the central ledger on boot.
 *
 * Micronote batches last 8 hours (configurable) and then close and do not accept any more notes
 *
 */
export default new ApiHandler('MicronoteBatch.fund', {
  async handler({ batchSlug, note }, options) {
    const batch = await MicronoteBatchManager.get(batchSlug);
    if (batch.isClosed) {
      throw new MicronoteBatchClosedError();
    }
    if (batch.isAllowingNewNotes === false) {
      throw new NewNotesNotBeingAcceptedError();
    }

    const micronoteBatchDb = await MicronoteBatchDb.get(batchSlug);

    const address = note.fromAddress;
    let blockHeight = await BlockManager.currentBlockHeight();
    if (blockHeight < note.effectiveBlockHeight) {
      blockHeight = note.effectiveBlockHeight;
    }

    const { id: fundsId } = await db.transaction(async client => {
      const wallet = new Wallet(client, address);
      await wallet.lock();
      await wallet.load();

      const noteRecord = new Note(client, note);
      await noteRecord.save(wallet);

      return micronoteBatchDb.transaction(async batchClient => {
        const funding = new MicronoteFunds(batchClient, batch, address);
        await funding.createLock();
        // validates "toAddress" corresponds to this batch
        return funding.createFromNote(noteRecord);
      }, options);
    }, options);

    return {
      fundsId,
    };
  },
});
