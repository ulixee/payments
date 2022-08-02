import Log from '@ulixee/commons/lib/Logger';
import { Pool, PoolClient, PoolConfig, QueryResult, types } from 'pg';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import TypeSerializer from '@ulixee/commons/lib/TypeSerializer';
import { TypedEventEmitter } from '@ulixee/commons/lib/eventUtils';
import PgClient from './PgClient';

const { log } = Log(module);

types.setTypeParser(types.builtins.JSON, x => TypeSerializer.parse(x));
types.setTypeParser(types.builtins.INT8, BigInt);

export default class PgPool<K extends keyof typeof DbType = DbType.Main> extends TypedEventEmitter<{
  close: void;
}> {
  private pool: Pool;
  private isEnded = false;
  private config: PoolConfig;
  private shutdownTimeout: NodeJS.Timeout;

  constructor(readonly name: string, conf: PoolConfig) {
    super();
    const config = {
      ...conf,
    };
    if (!config.connectionTimeoutMillis) {
      config.connectionTimeoutMillis = 30e3;
    }
    this.pool = new Pool(config);
    log.info('Initializing db', { ...config, password: null, sessionId: null });
    this.pool.on('error', async error => {
      log.error('Unexpected error on idle client', { error, sessionId: null });
      try {
        await this.recyclePool();
      } catch (error2) {
        log.error('Error ending pool on error', { error: error2, sessionId: null });
      }
    });
  }

  public async recyclePool(): Promise<void> {
    const oldPool = this.pool;
    this.pool = new Pool(this.config);
    if (this.isEnded) {
      return;
    }
    try {
      await oldPool.end();
    } catch (err) {
      log.warn(`ERROR trying to recycle old pool ${err}\n${err.stack}`);
    }
    this.isEnded = false;
  }

  public async shutdown(): Promise<void> {
    clearTimeout(this.shutdownTimeout);
    if (this.pool && !this.isEnded) {
      this.isEnded = true;
      await this.pool.end();
      this.emit('close');
    }
  }

  public shutdownOnTimeout(millis: number): void {
    if (this.shutdownTimeout) return;
    this.shutdownTimeout = setTimeout(this.shutdown.bind(this), millis).unref();
  }

  public async healthCheck(): Promise<boolean> {
    const client = await this.pool.connect();

    try {
      const res = await client.query('SELECT 1');
      if (!res.rows) {
        throw new Error('Could not connect');
      }
      return true;
    } finally {
      client.release();
    }
  }

  public async query(query: string, args?: any[]): Promise<QueryResult> {
    return await this.pool.query(query, args);
  }

  public async connect(): Promise<PoolClient> {
    return await this.pool.connect();
  }

  public async transaction<T = any>(
    cb: (client: PgClient<K>) => Promise<T>,
    opts?: ITransactionOptions,
  ): Promise<T> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      if (error.toString().includes('connection timeout')) {
        await new Promise(resolve => setTimeout(resolve, 400));
        return this.transaction<T>(cb, opts);
      }
      throw error;
    }
    const wrapper = new PgClient<K>(client, opts);
    try {
      await wrapper.query('BEGIN');
      const returnVal = await cb(wrapper);
      await wrapper.query('COMMIT');
      return returnVal;
    } catch (e) {
      await wrapper.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

export interface ITransactionOptions {
  logger?: IBoundLog;
  logQueries?: boolean;
  retries?: number;
}

export enum DbType {
  Main = 'Main',
  Batch = 'Batch',
}
