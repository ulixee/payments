import { ITransaction } from '@ulixee/specification';
import TypeSerializer from '@ulixee/commons/lib/TypeSerializer';
import PgClient from '../lib/PgClient';
import { DbType } from '../lib/PgPool';

export default class MainchainTransaction {
  public get transaction(): ITransaction {
    return this.data.data;
  }

  public data: IMainchainTransactionRecord;

  constructor(readonly client: PgClient<DbType.Default>, data?: IMainchainTransactionRecord) {
    this.data = data;
    if (typeof data.data === 'string') {
      this.data.data = TypeSerializer.parse(data.data);
    }
  }

  public async save(): Promise<MainchainTransaction> {
    await this.client.insert('mainchain_transactions', this.data);
    return this;
  }

  public static async getTransaction(
    client: PgClient<DbType.Default>,
    transactionHash: Buffer,
  ): Promise<ITransaction> {
    const record = await client.queryOne<IMainchainTransactionRecord>(
      'select data from mainchain_transactions where transaction_hash = $1',
      [transactionHash],
    );
    return record.data;
  }

  public static fromTransaction(
    client: PgClient<DbType.Default>,
    transaction: ITransaction,
  ): MainchainTransaction {
    return new MainchainTransaction(client, {
      transactionHash: transaction.transactionHash,
      data: transaction,
    });
  }
}

export interface IMainchainTransactionRecord {
  transactionHash: Buffer;
  data: ITransaction;
}
