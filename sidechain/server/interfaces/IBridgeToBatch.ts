import { Duplex } from 'stream';
import { IMicronoteBatchOutputRecord } from '../main/models/MicronoteBatchOutput';
import { IHandlerOptions } from '../utils/ApiHandler';

export default interface IBridgeToBatch {
  closeBatch(
    batchSlug: string,
    batchBalance: bigint,
    noteHashes: Buffer[],
    opts: IHandlerOptions,
  ): Promise<void>;
  getBatchSummary(batchSlug: string): Promise<IMicronoteBatchOutputRecord>;
  getBatchOutputStream(
    batchSlug: string,
    onComplete: (noteStream: Duplex) => Promise<void>,
  ): Promise<void>;
}
