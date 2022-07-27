import { NoteType } from '@ulixee/specification';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import config from '../config';
import {
  ConflictError,
  InvalidParameterError,
  MicronoteFundsNeededError,
  NotFoundError,
} from '../lib/errors';
import PgClient from '../lib/PgClient';
import { DbType } from '../lib/PgPool';
import MicronoteBatch from './MicronoteBatch';
import Note from './Note';

const minFunding = config.micronoteBatch.minimumFundingCentagons;

export default class MicronoteFunds {
  public id: number;
  private logger: IBoundLog;
  constructor(
    readonly client: PgClient<DbType.Batch>,
    readonly batch: MicronoteBatch,
    readonly clientAddress: string,
  ) {
    this.logger = client.logger;
  }

  public async createLock(): Promise<void> {
    try {
      await this.client.insert('locks', { address: this.clientAddress }, true);
    } catch (err) {
      if (err.code === 'ERR_DUPLICATE' && err.data && err.data.type === 'locks') {
        return;
      }
      throw err;
    }
  }

  public async lockClient(): Promise<void> {
    const { rows } = await this.client.query(
      'SELECT 1 from locks WHERE address = $1 LIMIT 1 FOR UPDATE',
      [this.clientAddress],
    );
    if (!rows.length) {
      throw new NotFoundError('The wallet provided could not found', this.clientAddress);
    }
  }

  public async holdTokens(
    fundsId: number,
    microgons: number,
  ): Promise<{ guaranteeBlockHeight: number; microgonsRemaining: number }> {
    // NOTE: double check public key just for extra sanity
    const { rowCount } = await this.client.query(
      `UPDATE micronote_funds SET 
      microgons_allocated = microgons_allocated + $2
      WHERE id = $1 and address = $3 and microgons >= (microgons_allocated + $2)`,
      [fundsId, microgons, this.clientAddress],
    );
    if (rowCount !== 1) {
      throw new MicronoteFundsNeededError(
        'No current micronoteBatch funding found. Please fund a new micronoteBatch.',
        Math.max(Number(minFunding), Math.ceil(microgons / 10e3)),
      );
    }
    const record = await this.client.queryOne<{
      guaranteeBlockHeight: number;
      microgonsRemaining: number;
    }>(
      `select 
      (microgons - microgons_allocated) as microgons_remaining,
      guarantee_block_height 
      from micronote_funds where id=$1`,
      [fundsId],
    );
    return record;
  }

  public async returnHoldTokens(fundsId: number, microgons: number): Promise<boolean> {
    const { rowCount } = await this.client.query(
      `UPDATE micronote_funds SET 
      microgons_allocated = microgons_allocated - $2
      WHERE id = $1 and address = $3`,
      [fundsId, microgons, this.clientAddress],
    );
    if (rowCount !== 1) {
      throw new ConflictError('Could not hold the appropriate number of microgons');
    }
    return true;
  }

  public async find(microgons: number): Promise<{ microgonsRemaining: number; fundsId: number }> {
    const params = [this.clientAddress, microgons];
    const { rows } = await this.client.query<{ id: number; microgonsRemaining: number }>(
      `SELECT id, 
        (microgons - microgons_allocated) as microgons_remaining
      FROM micronote_funds 
        WHERE address = $1 and microgons >= (microgons_allocated + $2)
      LIMIT 1`,
      params,
    );

    if (!rows.length) {
      return null;
    }
    this.logger.info('Got datanet funding back', {
      microgons,
      isEnough: rows[0].microgonsRemaining >= microgons,
      first: rows[0],
    });
    const [batch] = rows;
    return {
      fundsId: batch.id,
      microgonsRemaining: batch.microgonsRemaining,
    };
  }

  public async createFromNote(note: Note): Promise<IMicronoteFundsRecord> {
    const { fromAddress, toAddress, centagons } = note.data;

    if (fromAddress !== this.clientAddress) {
      throw new InvalidParameterError(
        'The source public key for the provided note does not match the requestor',
      );
    }

    if (note.data.type !== NoteType.micronoteFunds) {
      throw new InvalidParameterError(
        'This MicronoteBatch funding note must have a type of "micronoteFunds"',
        'type',
        {
          type: NoteType[note.data.type],
        },
      );
    }

    if (toAddress !== this.batch.address) {
      throw new InvalidParameterError(
        'The note to create this MicronoteBatch sent the microgons to a public key that is NOT the current MicronoteBatch',
        'address',
        {
          micronoteBatchAddress: this.batch.address,
          destinationAddress: toAddress,
        },
      );
    }

    if (Number(centagons) * 10e3 < minFunding) {
      throw new InvalidParameterError(
        `The minimum batch allowed requires ${minFunding} microgons`,
        'centagons',
        { centagons, minFunding },
      );
    }

    const batch = await MicronoteFunds.createFromNote(this.client, note);
    this.id = batch.id;
    return batch;
  }

  public static async createFromNote(
    client: PgClient<DbType.Batch>,
    transaction: Note,
  ): Promise<IMicronoteFundsRecord> {
    const { fromAddress, centagons, noteHash, timestamp, guaranteeBlockHeight } = transaction.data;
    return await client.insertWithId('micronote_funds', {
      address: fromAddress,
      noteHash,
      microgons: Number(centagons) * 10e3,
      microgonsAllocated: 0,
      createdTime: timestamp,
      lastUpdatedTime: new Date(),
      guaranteeBlockHeight,
    });
  }

  public static async find(
    client: PgClient<DbType.Batch>,
    ids: number[],
  ): Promise<IMicronoteFundsRecord[]> {
    if (!ids.length) return [];
    return await client.list(`select * from micronote_funds where id = ANY ($1)`, ids);
  }
}

export interface IMicronoteFundsRecord {
  id: number;
  address: string;
  noteHash: Buffer;
  guaranteeBlockHeight: number;
  microgons: number;
  microgonsAllocated: number;
  createdTime: Date;
  lastUpdatedTime: Date;
}
