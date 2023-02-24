import { sha256 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer } from '@ulixee/commons/lib/bufferUtils';
import { NotFoundError } from '@ulixee/payment-utils/lib/errors';
import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';
import BlockManager from '../lib/BlockManager';

export default class Stake {
  public get identity(): string {
    return this.data.identity;
  }

  public data: IStakeRecord;

  constructor(readonly client: PgClient<DbType.Main>, data?: Partial<IStakeRecord>) {
    this.data = data as IStakeRecord;
  }

  public async save(): Promise<Stake> {
    await this.client.insert('stakes', this.data);
    return this;
  }

  public createHash(blockHeight: number): Buffer {
    return sha256(concatAsBuffer(this.identity, blockHeight));
  }

  public async refund(refundNoteHash: Buffer): Promise<{ blockEndHeight: number }> {
    const inserted = await this.client.insert<IStakeHistoryRecord>('stake_history', {
      ...this.data,
      blockEndHeight: await BlockManager.currentBlockHeight(),
      closedDate: new Date(),
      refundNoteHash,
    });
    await this.client.update('delete from stakes where identity = $1', [this.identity]);
    return {
      blockEndHeight: inserted.blockEndHeight,
    };
  }

  public static async lock(client: PgClient<DbType.Main>, identity: string): Promise<Stake> {
    const { rows } = await client.query(
      'select * from stakes where identity = $1 LIMIT 1 FOR UPDATE',
      [identity],
    );
    if (!rows.length) {
      throw new NotFoundError('Could not lock this stake for update', identity);
    }
    return new Stake(client, rows[0]);
  }
}

export interface IStakeRecord {
  identity: string;
  address: string;
  noteHash: Buffer;
  blockStartHeight: number;
  openDate: Date;
}

export interface IStakeHistoryRecord {
  identity: string;
  address: string;
  noteHash: Buffer;
  blockStartHeight: number;
  blockEndHeight: number;
  refundNoteHash?: Buffer;
  openDate: Date;
  closedDate: Date;
}
