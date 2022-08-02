import { nanoid } from 'nanoid';
import PgClient from '../../utils/PgClient';
import { DbType } from '../../utils/PgPool';

export default class Credit {
  constructor(
    readonly client: PgClient<DbType.Batch>,
    public data?: ICreditRecord,
    public id?: string,
  ) {}

  public async claim(address: string): Promise<Credit> {
    this.data.claimAddress = address;
    await this.client.update(
      `UPDATE credits
      SET claim_address = $2,
          claimed_time = now(),
          last_updated_time = now()
      WHERE id = $1
        AND claim_address is null
        AND claimed_time is null`,
      [this.id, address],
    );
    return this;
  }

  public async lock(): Promise<void> {
    this.data = await this.client.queryOne<ICreditRecord>(
      `select * from credits where id=$1 LIMIT 1 FOR UPDATE`,
      [this.id],
    );
  }

  public async saveFund(fundsId: number): Promise<void> {
    this.data.fundsId = fundsId;
    await this.client.update(
      `UPDATE credits set funds_id = $1, funded_time = NOW() where id=$2 and funds_id is null`,
      [fundsId, this.id],
    );
  }

  public async create(record: Partial<ICreditRecord>): Promise<Credit> {
    const creditId = nanoid(32);
    this.id = creditId;
    const time = new Date();
    this.data = {
      id: creditId,
      microgons: record.microgons,
      allowedRecipientAddresses: record.allowedRecipientAddresses,
      allowedRecipientSignatures: record.allowedRecipientSignatures,
      createdTime: time,
      lastUpdatedTime: time,
    };

    await this.client.insert<ICreditRecord>('credits', this.data);
    return this;
  }
}

export interface ICreditRecord {
  id: string;
  microgons: number;
  allowedRecipientAddresses: string[];
  allowedRecipientSignatures: any;
  claimAddress?: string;
  claimedTime?: Date;
  fundsId?: number;
  fundedTime?: Date;
  createdTime: Date;
  lastUpdatedTime: Date;
}
