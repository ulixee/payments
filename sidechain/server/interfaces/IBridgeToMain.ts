import { INote } from '@ulixee/specification';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import { IHandlerOptions } from '../utils/ApiHandler';

export { IMicronoteBatchOutputRecord } from '../main/models/MicronoteBatchOutput';

export default interface IBridgeToMain {
  currentBlock(): Promise<{ height: number; hash: Buffer }>;
  saveNote<T>(
    note: INote,
    nestedTx: (noteRecord: INote) => Promise<T>,
    options: IHandlerOptions,
  ): Promise<T>;
  getNote(hash: Buffer, logger: IBoundLog): Promise<INote>;
}
