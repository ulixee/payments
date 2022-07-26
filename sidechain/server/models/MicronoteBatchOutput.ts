import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { INote, NoteType } from '@ulixee/specification';
import PgClient from '../lib/PgClient';
import { DbType } from '../lib/PgPool';

export default class MicronoteBatchOutput {
  public data?: IMicronoteBatchOutputRecord;

  constructor(readonly client: PgClient<DbType.Default>, data?: IMicronoteBatchOutputRecord) {
    this.data = data;
  }

  public async save(): Promise<MicronoteBatchOutput> {
    await this.client.insert<IMicronoteBatchOutputRecord>('micronote_batch_outputs', this.data);
    return this;
  }

  public toJSON(): IMicronoteBatchOutputRecord {
    return this.data;
  }

  public async recordBurnSecurity(
    client: PgClient<DbType.Default>,
    transactionHash: Buffer,
  ): Promise<void> {
    this.data.burnSecurityTransactionHash = transactionHash;
    await client.update(
      `
    UPDATE micronote_batch_outputs 
      SET burn_security_transaction_hash = $2
    WHERE address = $1
      AND burn_security_transaction_hash is null`,
      [this.data.address, transactionHash],
    );
  }

  public static async load(
    client: PgClient<DbType.Default>,
    address: string,
  ): Promise<MicronoteBatchOutput> {
    const record = await client.queryOne<IMicronoteBatchOutputRecord>(
      'SELECT * from micronote_batch_outputs WHERE address = $1',
      [address],
    );

    return new MicronoteBatchOutput(client, record);
  }

  public static async findUnburned(
    client: PgClient<DbType.Default>,
  ): Promise<{ unburnedBatchOutputs: IMicronoteBatchOutputRecord[]; centagonsToBurn: bigint }> {
    const unburnedBatchOutputs = await client.list<IMicronoteBatchOutputRecord>(
      'SELECT * from micronote_batch_outputs WHERE burn_security_transaction_hash is null',
    );

    const centagonsToBurn = unburnedBatchOutputs.reduce(
      (total, entry) => total + entry.burnedCentagons,
      0n,
    );

    return {
      unburnedBatchOutputs,
      centagonsToBurn,
    };
  }

  public static async findWithSecurity(
    client: PgClient<DbType.Default>,
    transactionHash: Buffer,
  ): Promise<MicronoteBatchOutput[]> {
    const records = await client.list<IMicronoteBatchOutputRecord>(
      `SELECT * from micronote_batch_outputs 
      WHERE burn_security_transaction_hash  = $1`,
      [transactionHash],
    );
    return records.map(record => new MicronoteBatchOutput(client, record));
  }

  public static async createFromMicronoteBatchDb(
    batchClient: PgClient<DbType.Batch>,
    defaultClient: PgClient<DbType.Default>,
    micronoteBatchAddress: string,
  ): Promise<MicronoteBatchOutput> {
    const noteHashes = await batchClient.list<Pick<INote, 'noteHash'>>(`
       SELECT note_hash 
       FROM note_outputs
       ORDER BY note_hash`);

    const { settledCentagons } = await batchClient.queryOne(
      `
       SELECT SUM(centagons)::bigint as settled_centagons
       FROM note_outputs
       WHERE type not in ($1,$2)
    `,
      [NoteType.settlementFees, NoteType.burn],
    );

    const { settlementFeeCentagons } = await batchClient.queryOne(
      `
       SELECT SUM(centagons)::bigint as settlement_fee_centagons
       FROM note_outputs
       WHERE type = $1
    `,
      [NoteType.settlementFees],
    );

    const { rows: burnRows } = await batchClient.query(
      `
       SELECT *
       FROM note_outputs
       WHERE type = $1
       LIMIT 1
    `,
      [NoteType.burn],
    );
    const burnNote = burnRows && burnRows.length ? (burnRows[0] as INote) : null;

    const notesHash = sha3(Buffer.concat(noteHashes.map(x => x.noteHash)));

    const { funds, allocated, maxGuaranteeBlockHeight } = await batchClient.queryOne(`
       SELECT SUM(microgons_allocated) as allocated,
          SUM(microgons) as funds, 
          MAX(guarantee_block_height) as max_guarantee_block_height
       FROM micronote_funds`);

    const { revenue } = await batchClient.queryOne(`
       SELECT SUM(microgons_earned) as revenue
       FROM micronote_recipients 
       WHERE microgons_earned > 0`);

    const { micronotes, maxBlockHeight, minBlockHeight } = await batchClient.queryOne(`
       SELECT COUNT(1) as micronotes, 
         MAX(block_height) as max_block_height, 
         MIN(block_height) as min_block_height
       FROM micronotes 
         WHERE claimed_time is not null`);

    return new MicronoteBatchOutput(defaultClient, {
      address: micronoteBatchAddress,
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
    });
  }
}

export interface IMicronoteBatchOutputRecord {
  address: string;
  archivePath?: string;
  startBlockHeight: number;
  endBlockHeight: number;
  guaranteeBlockHeight: number;
  newNotesCount: number;
  newNotesHash: Buffer;
  micronotesCount: number;
  fundingMicrogons: bigint;
  allocatedMicrogons: bigint;
  revenueMicrogons: bigint;
  settlementFeeCentagons: bigint;
  settledCentagons: bigint;
  burnedCentagons: bigint;
  burnNoteHash?: Buffer;
  burnSecurityTransactionHash?: Buffer;
}
