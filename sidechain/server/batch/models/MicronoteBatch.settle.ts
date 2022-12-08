import { CopyToStreamQuery, to } from 'pg-copy-streams';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import { INote, NoteType } from '@ulixee/specification';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';
import { NotFoundError } from '@ulixee/payment-utils/lib/errors';
import { IMicronoteBatchOutputRecord } from '../../interfaces/IBridgeToMain';
import { ActiveBatches } from '../index';
import BatchDb from '../db';

export default class MicronoteBatchSettle {
  public batchOutput: IMicronoteBatchOutputRecord;

  private readonly logger: IBoundLog;

  constructor(readonly client: PgClient<DbType.Batch>, readonly batchAddress: string) {
    this.logger = client.logger.createChild(module, { action: 'MicronoteBatch.settle' });
  }

  public async run(): Promise<void> {
    this.batchOutput = await this.generateBatchOutput();
  }

  private async generateBatchOutput(): Promise<IMicronoteBatchOutputRecord> {
    const noteHashes = await this.client.list<{ noteHash: Buffer }>(`
       SELECT note_hash 
       FROM note_outputs
       ORDER BY note_hash`);

    const { settledCentagons } = await this.client.queryOne<{
      settledCentagons: bigint;
    }>(
      `
       SELECT SUM(centagons)::bigint as settled_centagons
       FROM note_outputs
       WHERE type not in ($1,$2)
    `,
      [NoteType.settlementFees, NoteType.burn],
    );

    const { settlementFeeCentagons } = await this.client.queryOne<{
      settlementFeeCentagons: bigint;
    }>(
      `
       SELECT SUM(centagons)::bigint as settlement_fee_centagons
       FROM note_outputs
       WHERE type = $1
    `,
      [NoteType.settlementFees],
    );

    const { rows: burnRows } = await this.client.query<INote>(
      `
       SELECT *
       FROM note_outputs
       WHERE type = $1
       LIMIT 1
    `,
      [NoteType.burn],
    );
    const burnNote = burnRows?.length ? burnRows[0] : null;

    const notesHash = sha3(Buffer.concat(noteHashes.map(x => x.noteHash)));

    const { funds, allocated, maxGuaranteeBlockHeight } = await this.client.queryOne<{
      funds: bigint;
      allocated: bigint;
      maxGuaranteeBlockHeight: number;
    }>(`
       SELECT SUM(microgons_allocated) as allocated,
          SUM(microgons) as funds, 
          MAX(guarantee_block_height) as max_guarantee_block_height
       FROM micronote_funds`);

    const { revenue } = await this.client.queryOne<{ revenue: bigint }>(`
       SELECT SUM(microgons_earned) as revenue
       FROM micronote_recipients 
       WHERE microgons_earned > 0`);

    const { micronotes, maxBlockHeight, minBlockHeight } = await this.client.queryOne<{
      micronotes: bigint;
      maxBlockHeight: number;
      minBlockHeight: number;
    }>(`
       SELECT COUNT(1) as micronotes, 
         MAX(block_height) as max_block_height, 
         MIN(block_height) as min_block_height
       FROM micronotes 
         WHERE has_settlements = true`);

    return {
      address: this.batchAddress,
      newNotesHash: notesHash,
      newNotesCount: noteHashes.length,
      fundingMicrogons: funds ?? 0n,
      allocatedMicrogons: allocated ?? 0n,
      revenueMicrogons: revenue ?? 0n,
      micronotesCount: Number(micronotes || 0),
      settledCentagons: settledCentagons ?? 0n,
      settlementFeeCentagons: settlementFeeCentagons ?? 0n,
      burnedCentagons: burnNote ? burnNote.centagons : 0n,
      burnNoteHash: burnNote ? burnNote.noteHash : null,
      startBlockHeight: Number(minBlockHeight || 0),
      endBlockHeight: Number(maxBlockHeight || 0),
      guaranteeBlockHeight: Number(maxGuaranteeBlockHeight || 0),
    };
  }

  public static async get(
    batchSlug: string,
    options?: { logger: IBoundLog },
  ): Promise<IMicronoteBatchOutputRecord> {
    const batch = await ActiveBatches.get(batchSlug);
    const batchDb = BatchDb.get(batch.slug, false);
    if (!batchDb) throw new NotFoundError('Micronote Batch not found');

    return await batchDb.transaction(async client => {
      const settled = new MicronoteBatchSettle(client, batch.address);
      await settled.run();
      return settled.batchOutput;
    }, options);
  }

  public static noteOutputStream(client: PgClient<DbType.Batch>): CopyToStreamQuery {
    return client.queryStream(to('COPY note_outputs TO STDOUT'));
  }
}
