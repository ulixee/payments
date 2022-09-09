import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';

export default class MicronoteBatchOutput {
  public data?: IMicronoteBatchOutputRecord;

  constructor(readonly client: PgClient<DbType.Main>, data?: IMicronoteBatchOutputRecord) {
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
    client: PgClient<DbType.Main>,
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
    client: PgClient<DbType.Main>,
    address: string,
  ): Promise<MicronoteBatchOutput> {
    const record = await client.queryOne<IMicronoteBatchOutputRecord>(
      'SELECT * from micronote_batch_outputs WHERE address = $1',
      [address],
    );

    return new MicronoteBatchOutput(client, record);
  }

  public static async findUnburned(
    client: PgClient<DbType.Main>,
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
    client: PgClient<DbType.Main>,
    transactionHash: Buffer,
  ): Promise<MicronoteBatchOutput[]> {
    const records = await client.list<IMicronoteBatchOutputRecord>(
      `SELECT * from micronote_batch_outputs 
      WHERE burn_security_transaction_hash  = $1`,
      [transactionHash],
    );
    return records.map(record => new MicronoteBatchOutput(client, record));
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
