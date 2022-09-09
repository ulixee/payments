import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';
import RampApp from '../lib/RampApp';
import EthereumHDWallet from '../lib/EthereumHDWallet';

export default class RampLock {
  public static table = 'locks';

  constructor(readonly client: PgClient<DbType.Ramp>) {}

  public static async createInTransaction(id: string): Promise<void> {
    await RampApp.db.transaction(client => this.create(client, id));
  }

  public static async create(client: PgClient<DbType.Ramp>, id: string): Promise<void> {
    await client.insert(this.table, { id }, true);
  }

  public static async lock(client: PgClient<DbType.Ramp>, id: string): Promise<void> {
    const { rows } = await client.query(
      `select 1 from ${this.table} where id=$1 FOR UPDATE LIMIT 1`,
      [id],
    );
    if (!rows.length) throw new Error(`Could not lock ${id}`);
  }

  public static async init(rootWallets: EthereumHDWallet<any>[]): Promise<void> {
    await RampApp.db.transaction(async client => {
      for (const wallet of rootWallets) {
        await RampLock.create(client, wallet.meta.rootWalletGuid);
      }
    });
  }
}
