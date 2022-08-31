import { hashObject } from '@ulixee/commons/lib/hashUtils';
import { InvalidSignatureError } from '@ulixee/crypto/lib/errors';
import AddressSignature from '@ulixee/crypto/lib/AddressSignature';
import { IAddressSignature, NoteType } from '@ulixee/specification';
import Address from '@ulixee/crypto/lib/Address';
import { Duplex } from 'stream';
import { from } from 'pg-copy-streams';
import addNoteSignature, { hashNote } from '@ulixee/sidechain/lib/addNoteSignature';
import BlockManager from '../lib/BlockManager';
import {
  ConflictError,
  InsufficientFundsError,
  InvalidNoteHashError,
  InvalidParameterError,
} from '../../utils/errors';
import MainDb from '../db';
import PgClient from '../../utils/PgClient';
import { DbType, ITransactionOptions } from '../../utils/PgPool';
import RegisteredAddress from './RegisteredAddress';

export default class Note {
  public data: INoteRecord;

  constructor(
    readonly client: PgClient<DbType.Main>,
    data: Omit<INoteRecord, 'guaranteeBlockHeight'> & { guaranteeBlockHeight?: number },
  ) {
    this.data = data as any;
  }

  public async save(
    fundingSourceWallet: RegisteredAddress,
    guaranteeBlockHeight?: number,
  ): Promise<Note> {
    if (this.data.centagons <= 0) {
      throw new InvalidParameterError('Centagons must be greater than 0', 'centagons', {
        centagons: this.data.centagons,
      });
    }

    // don't allow block heights in the past
    if (
      this.data.effectiveBlockHeight &&
      this.data.effectiveBlockHeight < (await BlockManager.currentBlockHeight())
    ) {
      throw new InvalidParameterError(
        'Invalid effective block height proposed',
        'effectiveBlockHeight',
        {
          effectiveBlockHeight: this.data.effectiveBlockHeight,
          currentBlockHeight: await BlockManager.currentBlockHeight(),
        },
      );
    }

    if (fundingSourceWallet.balance < this.data.centagons) {
      throw new InsufficientFundsError(
        `The source wallet does not have enough centagons to create this note (note centagons: ${this.data.centagons})`,
        fundingSourceWallet.balance.toString(),
      );
    }

    if (this.data.noteHash && !this.getHash().equals(this.data.noteHash)) {
      throw new InvalidNoteHashError();
    }

    const invalidSignatureReason = AddressSignature.verify(
      this.data.fromAddress,
      this.data.signature,
      this.data.noteHash,
      false,
    );

    if (invalidSignatureReason) {
      throw new InvalidSignatureError(invalidSignatureReason);
    }

    return await this.saveUnchecked(guaranteeBlockHeight);
  }

  public async saveUnchecked(guaranteeBlockHeight?: number): Promise<Note> {
    try {
      this.data.guaranteeBlockHeight = guaranteeBlockHeight;
      if (!this.data.guaranteeBlockHeight && this.data.guaranteeBlockHeight !== 0) {
        this.data.guaranteeBlockHeight = await Note.findMostRecentGuaranteeForAddress(
          this.client,
          this.data.fromAddress,
        );
      }
      await this.client.insert<INoteRecord>('notes', this.data);
      return this;
    } catch (error) {
      this.client.logger.error('ERROR creating note', { error });
      throw new ConflictError('Could not record note. Ensure the note has valid parameters');
    }
  }

  public getHash(): Buffer {
    return hashNote(this.data);
  }

  public static async findMostRecentGuaranteeForAddress(
    client: PgClient<DbType.Main>,
    address: string,
  ): Promise<number> {
    const record = await client.queryOne<Pick<INoteRecord, 'guaranteeBlockHeight'>>(
      `
    select guarantee_block_height from notes
    where to_address = $1
    order by guarantee_block_height desc
    limit 1
    `,
      [address],
    );

    return record.guaranteeBlockHeight;
  }

  public static async importPgStream(client: PgClient<DbType.Main>, stream: Duplex): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const input = client.queryStream(from('COPY notes FROM STDIN')).once('error', reject);
      stream.pipe(input).once('end', resolve).once('finish', resolve).once('error', reject);
    });
  }

  public static hash(data: Partial<INoteRecord>): Buffer {
    if (data.effectiveBlockHeight === null) delete data.effectiveBlockHeight;
    // guarantee block hash is assigned from server
    return hashObject(data, {
      ignoreProperties: ['signature', 'noteHash', 'guaranteeBlockHeight'],
    });
  }

  public static async load(noteHash: Buffer, options: ITransactionOptions): Promise<Note> {
    return await MainDb.transaction(async client => {
      const record = await client.queryOne<INoteRecord>(
        'select * from notes where note_hash = $1',
        [noteHash],
      );

      return new Note(client, record);
    }, options);
  }

  public static addSignature(data: Partial<INoteRecord>, address: Address): INoteRecord {
    return addNoteSignature(data, address) as any;
  }

  public static async totalCirculation(client: PgClient<DbType.Main>): Promise<bigint> {
    const { rows } = await client.preparedQuery<{ balance: bigint }>({
      text: `select
  (SELECT COALESCE(SUM(centagons),0)::bigint FROM notes where type = ANY($1)) -
  (SELECT COALESCE(SUM(centagons),0)::bigint FROM notes where type = ANY($2))  as balance`,
      name: 'circulation_query',
      values: [[NoteType.transferIn], [NoteType.burn, NoteType.transferOut]],
    });
    if (rows.length) {
      return rows[0].balance ?? 0n;
    }
    return 0n;
  }

  public static async loadWithHashes(
    client: PgClient<DbType.Main>,
    noteHashes: Buffer[],
  ): Promise<Note[]> {
    const opts = { logger: client.logger };
    return await Promise.all(noteHashes.map(hash => Note.load(hash, opts)));
  }
}

export interface INoteRecord {
  toAddress: string;
  fromAddress: string;
  centagons: bigint;
  noteHash: Buffer;
  type: NoteType;
  effectiveBlockHeight?: number;
  guaranteeBlockHeight: number;
  timestamp: Date;
  signature: IAddressSignature;
}
