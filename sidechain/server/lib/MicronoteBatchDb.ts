import * as fs from 'fs';
import * as path from 'path';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import config from '../config';
import PgPool, { DbType } from './PgPool';
import defaultDb from './defaultDb';

const pools: {
  pool: PgPool<any>;
  accesses: number;
}[] = [];

export default class MicronoteBatchDb {
  static batchNamePrefix = config.micronoteBatch.prefix;

  static get(slug: string, doNotCreateNewPool = false): Promise<PgPool<DbType.Batch>> {
    const db = this.getName(slug);
    const existing = pools.find(x => x.pool.name === db);
    if (existing) {
      existing.accesses += 1;
      return Promise.resolve(existing.pool);
    }
    if (doNotCreateNewPool) return Promise.resolve(null);

    if (pools.length >= 4) {
      pools.sort((a, b) => b.accesses - a.accesses);
      const last = pools.pop();
      if (last) {
        const lastPool = last.pool;
        // give any existing uses of the connection time to cleanup
        lastPool.shutdownOnTimeout(120e3);
      }
    }

    const pool = new PgPool<DbType.Batch>(db, { ...config.db, database: db });
    pools.push({
      pool,
      accesses: 1,
    });
    return Promise.resolve(pool);
  }

  static getName(slug: string): string {
    return `${this.batchNamePrefix}${slug}`;
  }

  static async createDb(slug: string, logger: IBoundLog): Promise<PgPool<DbType.Batch>> {
    const dbName = this.getName(slug);

    const defaultClient = await defaultDb.connect();
    try {
      await defaultClient.query(`CREATE DATABASE ${dbName}`);
    } finally {
      await defaultClient.release();
    }

    const micronoteBatchDb = await this.get(slug);
    const script = fs.readFileSync(path.join(__dirname, '../db-migrations-batch/schema.sql')).toString();

    await micronoteBatchDb.transaction(client => client.query(script), {
      logger,
    });
    return micronoteBatchDb;
  }
}
