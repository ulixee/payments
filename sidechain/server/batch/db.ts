import * as fs from 'fs';
import * as path from 'path';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import PgPool, { DbType } from '@ulixee/payment-utils/pg/PgPool';
import config from '../config';

const pools: {
  pool: PgPool<any>;
  accesses: number;
}[] = [];

export default class BatchDb {
  static batchNamePrefix = config.micronoteBatch.prefix;

  static async close(): Promise<void> {
    await Promise.allSettled(pools.map(x => x.pool.shutdown()));
    pools.length = 0;
  }

  static get(slug: string, doNotCreateNewPool = false): PgPool<DbType.Batch> {
    const db = this.getName(slug);
    const existing = pools.find(x => x.pool.database === db);
    if (existing) {
      existing.accesses += 1;
      return existing.pool;
    }
    if (doNotCreateNewPool) return null;

    if (pools.length >= 5) {
      pools.sort((a, b) => b.accesses - a.accesses);
      const last = pools.pop();
      if (last) {
        const lastPool = last.pool;
        // give any existing uses of the connection time to cleanup
        lastPool.shutdownOnTimeout(120e3);
      }
    }

    const pool = new PgPool<DbType.Batch>(db, config.db);
    pools.push({
      pool,
      accesses: 1,
    });
    pool.once('close', () => {
      const index = pools.findIndex(x => x.pool.database === db);
      if (index >= 0) pools.splice(index, 1);
    });
    return pool;
  }

  static getName(slug: string): string {
    return `${this.batchNamePrefix}${slug}`;
  }

  static async createDb(slug: string, logger: IBoundLog): Promise<PgPool<DbType.Batch>> {
    const batchDb = this.get(slug);
    const script = fs.readFileSync(path.join(__dirname, './migrations/schema.sql')).toString();

    await batchDb.transaction(client => client.query(script), {
      logger,
    });
    return batchDb;
  }
}
