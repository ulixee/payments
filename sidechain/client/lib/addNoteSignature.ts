import { hashObject } from '@ulixee/commons/lib/hashUtils';
import { INote } from '@ulixee/specification';
import Address from '@ulixee/crypto/lib/Address';

export default function addNoteSignature(note: Partial<INote>, address: Address): INote {
  if (!note.timestamp) {
    note.timestamp = new Date();
  }
  if (!note.effectiveBlockHeight || note.effectiveBlockHeight <= 0) {
    delete note.effectiveBlockHeight;
  }
  note.noteHash = hashNote(note);
  const keyIndices = Address.getIdentityIndices(address.addressSettings, false);
  note.signature = address.sign(note.noteHash, keyIndices, false);
  return note as INote;
}

export function hashNote(note: Partial<INote>): Buffer {
  if (note.effectiveBlockHeight === null) delete note.effectiveBlockHeight;
  // guarantee block hash is assigned from server
  return hashObject(note, {
    ignoreProperties: ['signature', 'noteHash', 'guaranteeBlockHeight'],
  });
}

