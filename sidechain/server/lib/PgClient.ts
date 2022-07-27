import Log from '@ulixee/commons/lib/Logger';
import * as camelcase from 'camelcase';
import * as decamelize from 'decamelize';
import { PoolClient, QueryConfig, QueryResult } from 'pg';
import { CopyToStreamQuery } from 'pg-copy-streams';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import TypeSerializer from '@ulixee/commons/lib/TypeSerializer';
import { ConflictError, DuplicateError, InvalidParameterError, NotFoundError } from './errors';
import { DbType } from './PgPool';

const { log: defaultLogger } = Log(module);
const jsKeyToDbKey: Record<string, string> = {};
const dbKeyToJsKey: Record<string, string> = {};

export default class PgClient<K extends keyof typeof DbType = DbType.Default> {
  public logger: IBoundLog;
  public type: K;
  private readonly logQueries: boolean = true;
  private shortQueryNameCache: { [query: string]: string } = {};

  constructor(readonly client: PoolClient, opts?: { logger?: IBoundLog; logQueries?: boolean }) {
    if (opts?.logQueries === false) {
      this.logQueries = false;
    }
    this.logger = opts?.logger ?? defaultLogger;
  }

  public queryStream(query: CopyToStreamQuery): CopyToStreamQuery {
    return this.client.query(query);
  }

  public async preparedQuery<T>(query: QueryConfig): Promise<QueryResult<T>> {
    try {
      const timer = process.hrtime();
      query.values = (query.values || []).map(prepareParam);
      const returnVal = await this.client.query<T>(query);
      const jsRows = (returnVal.rows || []).map(toJsObject);
      if (this.logQueries) {
        this.logger.info(`PreparedQuery (${query.name})`, {
          params: query.values,
          results: jsRows,
          queryMs: timeElapsed(timer),
          sessionId: null,
        });
      }
      return returnVal;
    } catch (err) {
      this.logger.error('ERROR executing query', { query, err });
      throw err;
    }
  }

  public async query<T>(
    query: string,
    values: any[] = [],
  ): Promise<{ rowCount: number; rows: T[] }> {
    try {
      const queryParams = (values || []).map(prepareParam);
      const timer = process.hrtime();
      const { rowCount, rows } = await this.client.query(query, queryParams);

      const jsRows = (rows || []).map(toJsObject);

      if (this.logQueries) {
        const shortenedName = this.getShortQueryName(query);
        this.logger.info(shortenedName, {
          query: query.replace(/\n/g, ' '),
          params: queryParams,
          results: jsRows,
          queryMs: timeElapsed(timer),
        });
      }
      return { rowCount, rows: jsRows };
    } catch (err) {
      this.logger.error(`ERROR executing query ${err}`, {
        query: query.replace(/\n/g, ' ').trim(),
        values,
        err,
      });
      throw err;
    }
  }

  public async queryOne<T>(query: string, params: any[] = []): Promise<T | null> {
    let finalQuery = query;
    if (!query.includes('LIMIT 1') && !query.includes('limit 1')) {
      finalQuery += ' LIMIT 1';
    }
    const { rows } = await this.query(finalQuery, params);
    if (!rows.length) {
      throw new NotFoundError('Failed to find record');
    }
    return toJsObject<T>(rows[0]);
  }

  public async list<T>(query: string, params: any[] = []): Promise<T[]> {
    const { rows } = await this.query<T>(query, params);
    return rows;
  }

  public async update(query: string, params: any[] = []): Promise<boolean> {
    const { rowCount } = await this.query(query, params);
    if (rowCount < 1) {
      throw new ConflictError('Failed to update record');
    }
    return true;
  }

  public async batchInsert<T = any>(
    tableName: string,
    insertSet: T[],
    recordSetSize = 50,
  ): Promise<T[]> {
    if (!insertSet.length) {
      return [];
    }

    const keys = Object.keys(insertSet[0]);
    const paramKeys = keys.map(convertToDbColumn);

    // break up insert into chunks
    const promises: Promise<{ rows: T[]; rowCount: number }>[] = [];
    let offset = 0;
    while (offset < insertSet.length) {
      const paramMap: string[] = [];
      const params: any[] = [];
      let paramCounter = 1;

      const records = insertSet.slice(offset, recordSetSize);
      for (const record of records) {
        const paramNumbers: string[] = [];
        for (const key of keys) {
          paramNumbers.push(`$${paramCounter}`);
          params.push(record[key]);
          paramCounter += 1;
        }
        paramMap.push(`(${paramNumbers.join(',')})`);
      }

      const promise = this.query<T>(
        `INSERT into ${tableName} (${paramKeys.join(',')}) VALUES ${paramMap.join(',')}`,
        params,
      );
      promises.push(promise);
      offset += recordSetSize;
    }

    const results = await Promise.all(promises);
    if (results.reduce((total, k) => k.rowCount + total, 0) !== insertSet.length) {
      throw new InvalidParameterError(`Failed to insert all ${insertSet.length} records`);
    }

    const records: T[] = [];
    for (const result of results) {
      records.push(...result.rows);
    }
    return records;
  }

  public async insertWithId<T = object>(tableName: string, obj: T): Promise<T & { id: number }> {
    return await this.insertInternal(tableName, obj, true);
  }

  public async insert<T = any>(
    tableName: string,
    obj: Partial<Record<keyof T, string | number | Date | BigInt | boolean | Buffer | object>>,
    ignoreConflict = false,
  ): Promise<T> {
    return await this.insertInternal(tableName, obj, false, ignoreConflict);
  }

  private async insertInternal<T = any>(
    tableName: string,
    obj: Partial<Record<keyof T, string | number | Date | BigInt | boolean | Buffer | object>>,
    withId = false,
    ignoreConflict = false,
  ): Promise<T> {
    let rowCount = 0;
    let rows = [];
    try {
      let extra = withId ? ' RETURNING ID' : '';
      if (ignoreConflict) {
        extra = `${extra} ON CONFLICT DO NOTHING`;
      }
      const recordKeys = Object.keys(obj);
      const keys: string[] = [];
      const values: any[] = [];
      const paramNumbers: string[] = [];
      for (const key of recordKeys) {
        keys.push(convertToDbColumn(key));
        values.push(prepareParam(obj[key]));
        paramNumbers.push(`$${keys.length}`);
      }
      ({ rowCount, rows } = await this.query(
        `INSERT INTO ${tableName} (${keys.join(',')}) VALUES (${paramNumbers.join(',')})${extra}`,
        values,
      ));
    } catch (err) {
      if (err.code === '23505') {
        throw new DuplicateError(err.message, tableName);
      }
      throw err;
    }

    if (rowCount < 1 && ignoreConflict !== true) {
      throw new InvalidParameterError('Failed to insert record');
    }
    if (rowCount && withId) {
      (obj as any).id = rows[0].id;
    }

    return obj as T;
  }

  private getShortQueryName(query: string): string {
    if (this.shortQueryNameCache[query]) return this.shortQueryNameCache[query];

    let shortenedName: string;
    if (query.match(/select\W/i)) {
      shortenedName = `Db Select (${query.match(/from\W+(\w+)\b/i)[1].trim()})`;
    } else if (query.match(/update\W/i)) {
      shortenedName = `Db Update (${query.match(/update\W+(\w+)\b/i)[1].trim()})`;
    } else if (query.match(/insert\W+into\W/i)) {
      shortenedName = `Db Insert (${query.match(/insert\W+into\W+(\w+)\b/i)[1].trim()})`;
    } else {
      shortenedName = `Db ${query.match(/(\w+)\W*/)[1]}`;
    }
    this.shortQueryNameCache[query] = shortenedName;
    return this.shortQueryNameCache[query];
  }
}

function timeElapsed(timer: [number, number]): string {
  const [secs, nanos] = process.hrtime(timer);
  return (secs * 1e3 + nanos / 1e6).toFixed(3);
}

function prepareParam(value): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    !(value instanceof Date) &&
    !Buffer.isBuffer(value)
  ) {
    return TypeSerializer.replace(value);
  }

  return value;
}

function convertToDbColumn(key: string): string {
  jsKeyToDbKey[key] ??= decamelize(key);
  return jsKeyToDbKey[key];
}

function toJsObject<T = any>(obj): T {
  const result = {} as T;
  for (const key of Object.keys(obj)) {
    dbKeyToJsKey[key] ??= camelcase(key);
    const map = dbKeyToJsKey[key];
    result[map] = obj[key];
  }
  return result;
}
