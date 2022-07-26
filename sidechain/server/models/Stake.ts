import { sha3 } from '@ulixee/commons/lib/hashUtils';
import BlockManager from '../lib/BlockManager';
import { NotFoundError } from '../lib/errors';
import PgClient from '../lib/PgClient';
import { DbType } from '../lib/PgPool';

export default class Stake {
  public get publicKey(): Buffer {
    return this.data.publicKey;
  }

  public data: IStakeRecord;

  constructor(readonly client: PgClient<DbType.Default>, data?: Partial<IStakeRecord>) {
    this.data = data as IStakeRecord;
  }

  public async save(): Promise<Stake> {
    await this.client.insert('stakes', this.data);
    return this;
  }

  public createHash(blockHeight: number): Buffer {
    return sha3(Buffer.concat([this.publicKey, Buffer.from(`${blockHeight}`)]));
  }

  public async refund(refundNoteHash: Buffer): Promise<{ blockEndHeight: number }> {
    const inserted = await this.client.insert<IStakeHistoryRecord>('stake_history', {
      ...this.data,
      blockEndHeight: await BlockManager.currentBlockHeight(),
      closedDate: new Date(),
      refundNoteHash,
    });
    await this.client.update('delete from stakes where public_key = $1', [this.publicKey]);
    return {
      blockEndHeight: inserted.blockEndHeight,
    };
  }

  public static async lock(client: PgClient<DbType.Default>, publicKey: Buffer): Promise<Stake> {
    const { rows } = await client.query(
      'select * from stakes where public_key = $1 LIMIT 1 FOR UPDATE',
      [publicKey],
    );
    if (!rows.length) {
      throw new NotFoundError('Could not lock this stake for update', publicKey.toString('hex'));
    }
    return new Stake(client, rows[0]);
  }
}

export interface IStakeRecord {
  publicKey: Buffer;
  address: string;
  noteHash: Buffer;
  blockStartHeight: number;
  openDate: Date;
}

export interface IStakeHistoryRecord {
  publicKey: Buffer;
  address: string;
  noteHash: Buffer;
  blockStartHeight: number;
  blockEndHeight: number;
  refundNoteHash?: Buffer;
  openDate: Date;
  closedDate: Date;
}
