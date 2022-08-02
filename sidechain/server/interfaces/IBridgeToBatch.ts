import { Duplex } from 'stream';
import { IMicronoteBatchOutputRecord } from '../main/models/MicronoteBatchOutput';
import { ITransactionOptions } from '../utils/PgPool';

export default interface IBridgeToBatch {
  closeBatch(
    batchSlug: string,
    batchBalance: bigint,
    noteHashes: Buffer[],
    opts: ITransactionOptions,
  ): Promise<void>;
  getBatchSummary(batchSlug: string): Promise<IMicronoteBatchOutputRecord>;
  getBatchOutputStream(
    batchSlug: string,
    onComplete: (noteStream: Duplex) => Promise<void>,
  ): Promise<void>;
}
