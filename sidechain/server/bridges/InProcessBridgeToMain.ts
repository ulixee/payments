import { INote } from '@ulixee/specification';
import IBridgeToMain from '../interfaces/IBridgeToMain';
import BlockManager from '../main/lib/BlockManager';
import MainDb from '../main/db';
import RegisteredAddress from '../main/models/RegisteredAddress';
import Note from '../main/models/Note';

// Bridges are meant to be a place holder for batch <-> main comms so we can eventually swap for apis if need be
const InProcessBridgeToMain = <IBridgeToMain>{
  async blockSettings() {
    return await BlockManager.settings;
  },

  async currentBlock() {
    return {
      hash: await BlockManager.currentBlockHash(),
      height: await BlockManager.currentBlockHeight(),
    };
  },

  async saveNote<T>(note, nestedTx, opts): Promise<T> {
    return await MainDb.transaction(async client => {
      const wallet = new RegisteredAddress(client, note.fromAddress);
      await wallet.lock();
      await wallet.load();

      const noteRecord = new Note(client, note);
      await noteRecord.save(wallet);
      return await nestedTx(noteRecord.data);
    }, opts);
  },
  getNote(hash, options): Promise<INote> {
    return Note.load(hash, options).then(x => x.data);
  },
  async lookupBalance(address: string, opts): Promise<bigint> {
    return await MainDb.transaction(client => RegisteredAddress.getBalance(client, address), opts);
  },
};

export default InProcessBridgeToMain;
