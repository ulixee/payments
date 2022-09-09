import { Duplex } from 'stream';
import { ITransactionOptions } from '@ulixee/payment-utils/pg/PgPool';
import { IMicronoteBatchOutputRecord } from '../main/models/MicronoteBatchOutput';

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
  closeDbs(): Promise<void>;
}
