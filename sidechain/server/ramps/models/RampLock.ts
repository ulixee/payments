import PgClient from '../../utils/PgClient';
import { DbType } from '../../utils/PgPool';
import RampDb from '../db';

export default class RampLock {
  public static table = 'locks';

  constructor(readonly client: PgClient<DbType.Ramp>) {}

  public static async createInTransaction(id: string): Promise<void> {
    await RampDb.transaction(client => this.create(client, id));
  }

  public static async create(client: PgClient<DbType.Ramp>, id: string): Promise<void> {
    await client.insert(this.table, { id }, true);
  }

  public static async lock(client: PgClient<DbType.Ramp>, id: string): Promise<void> {
    const { rows } = await client.query(`select 1 from ${this.table} where id=$1 FOR UPDATE LIMIT 1`, [id]);
    if (!rows.length) throw new Error(`Could not lock ${id}`);
  }
}
