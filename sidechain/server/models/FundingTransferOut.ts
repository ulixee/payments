import PgClient from '../lib/PgClient';
import { DbType } from '../lib/PgPool';
import { INoteRecord } from './Note';

export default class FundingTransferOut {
  public data: IFundingTransferOutRecord;

  constructor(
    readonly client: PgClient<DbType.Default>,
    data?: Partial<IFundingTransferOutRecord>,
  ) {
    this.data = data as IFundingTransferOutRecord;
  }

  public async save(): Promise<FundingTransferOut> {
    await this.client.insert<IFundingTransferOutRecord>('funding_transfers_out', {
      ...this.data,
    });
    return this;
  }

  public static async findPendingTransfers(
    client: PgClient<DbType.Default>,
  ): Promise<(INoteRecord & IFundingTransferOutRecord)[]> {
    return await client.list<INoteRecord & IFundingTransferOutRecord>(
      `select n.*, ft.*
      from notes n 
      join funding_transfers_out ft on ft.note_hash = n.note_hash 
      where ft.transaction_hash is null`,
    );
  }

  public static async recordTransaction(
    client: PgClient<DbType.Default>,
    transactionHash: Buffer,
    transfersOut: INoteRecord[],
  ): Promise<void> {
    const params = transfersOut.map((entry, i) => `$${i + 2}`).join(',');
    await client.update(
      `
      update funding_transfers_out set transaction_hash = $1
      where note_hash in (${params})
    `,
      [transactionHash, ...transfersOut.map(x => x.noteHash)],
    );
  }

  public static async find(
    client: PgClient<DbType.Default>,
    noteHash: Buffer,
  ): Promise<IFundingTransferOutRecord> {
    return await client.queryOne<IFundingTransferOutRecord>(
      'select * from funding_transfers_out where note_hash = $1',
      [noteHash],
    );
  }
}

export interface IFundingTransferOutRecord {
  transactionHash?: Buffer;
  noteHash: Buffer;
}
