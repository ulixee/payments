import { INote } from '@ulixee/specification';
import { ITransactionOptions } from '../utils/PgPool';

export { IMicronoteBatchOutputRecord } from '../main/models/MicronoteBatchOutput';

export default interface IBridgeToMain {
  currentBlock(): Promise<{ height: number; hash: Buffer }>;
  saveNote<T>(
    note: INote,
    nestedTx: (noteRecord: INote) => Promise<T>,
    options: ITransactionOptions,
  ): Promise<T>;
  getNote(hash: Buffer, options: ITransactionOptions): Promise<INote>;
  lookupBalance(address: string, options: ITransactionOptions): Promise<bigint>;
  getUsdToArgonConversionRate(): Promise<number>;
  totalCentagonsInCirculation(options: ITransactionOptions): Promise<bigint>;
}
