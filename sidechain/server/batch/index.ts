import { INote } from '@ulixee/specification';
import IMicronoteBatch from '@ulixee/specification/types/IMicronoteBatch';
import BlockManager from '../main/lib/BlockManager';
import MainDb from '../main/db';
import Wallet from '../main/models/Wallet';
import Note from '../main/models/Note';
import MicronoteBatchManager from '../main/lib/MicronoteBatchManager';
import IBatchState from '../interfaces/IBatchState';
import IBridgeToMain, { IMicronoteBatchOutputRecord } from '../interfaces/IBridgeToMain';
import IBridgeToBatch from '../interfaces/IBridgeToBatch';
import BatchDb from './db';
import MicronoteBatchSettle from './models/MicronoteBatch.settle';
import MicronoteBatchClose from './models/MicronoteBatch.close';

export const ActiveBatches = {
  get(slug: string): IBatchState {
    return MicronoteBatchManager.get(slug);
  },
  getCurrent(): IMicronoteBatch {
    const batch = MicronoteBatchManager.get();
    return { ...batch.getNoteParams() };
  },
};

export const bridgeToMain: IBridgeToMain = {
  async currentBlock() {
    return {
      hash: await BlockManager.currentBlockHash(),
      height: await BlockManager.currentBlockHeight(),
    };
  },
  async saveNote<T>(note, nestedTx, opts): Promise<T> {
    return await MainDb.transaction(async client => {
      const wallet = new Wallet(client, note.fromAddress);
      await wallet.lock();
      await wallet.load();

      const noteRecord = new Note(client, note);
      await noteRecord.save(wallet);
      return await nestedTx(noteRecord.data);
    }, opts);
  },
  getNote(hash, logger): Promise<INote> {
    return Note.load(hash, logger).then(x => x.data);
  },
};

export const bridgeToBatch: IBridgeToBatch = {
  async closeBatch(batchSlug, batchBalance, noteHashes, opts): Promise<void> {
    const batchDb = BatchDb.get(batchSlug);
    const batch = ActiveBatches.get(batchSlug);
    await batchDb.transaction(async batchClient => {
      const batchCloser = new MicronoteBatchClose(
        batchClient,
        batch.credentials.address,
        batchBalance,
        noteHashes,
      );
      await batchCloser.run();
    }, opts);
  },
  async getBatchOutputStream(batchSlug, onComplete): Promise<void> {
    await BatchDb.get(batchSlug).transaction(async client => {
      const stream = MicronoteBatchSettle.noteOutputStream(client);
      await onComplete(stream);
    });
  },
  async getBatchSummary(batchSlug): Promise<IMicronoteBatchOutputRecord> {
    return await MicronoteBatchSettle.get(batchSlug);
  },
};
