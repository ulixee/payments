import { hashObject } from '@ulixee/commons/lib/hashUtils';
import { InvalidSignatureError } from '@ulixee/crypto/lib/errors';
import AddressSignature from '@ulixee/crypto/lib/AddressSignature';
import { IAddressSignature, NoteType } from '@ulixee/specification';
import Address from '@ulixee/crypto/lib/Address';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import BlockManager from '../lib/BlockManager';
import {
  ConflictError,
  InsufficientFundsError,
  InvalidNoteHashError,
  InvalidParameterError,
} from '../lib/errors';
import db from '../lib/defaultDb';
import PgClient from '../lib/PgClient';
import { DbType } from '../lib/PgPool';
import Wallet from './Wallet';

export default class Note {
  public data: INoteRecord;

  constructor(
    readonly client: PgClient<DbType.Default>,
    data: Omit<INoteRecord, 'guaranteeBlockHeight'> & { guaranteeBlockHeight?: number },
  ) {
    this.data = data as any;
  }

  public async save(fundingSourceWallet: Wallet, guaranteeBlockHeight?: number): Promise<Note> {
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
        this.data.guaranteeBlockHeight = await Note.findMostRecentForWallet(
          this.client,
          this.data.fromAddress,
        );
      }
      await this.client.insert<INoteRecord>('notes', this.data);
      return this;
    } catch (error) {
      this.client.logger.error('ERROR creating note', { error });
      throw new ConflictError('Could not record note.  Ensure the note has valid parameters');
    }
  }

  public getHash(): Buffer {
    return Note.hash(this.data);
  }

  public static async findMostRecentForWallet(
    client: PgClient<DbType.Default>,
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

  public static hash(data: Partial<INoteRecord>): Buffer {
    if (data.effectiveBlockHeight === null) delete data.effectiveBlockHeight;
    // guarantee block hash is assigned from server
    return hashObject(data, {
      ignoreProperties: ['signature', 'noteHash', 'guaranteeBlockHeight'],
    });
  }

  public static async load(noteHash: Buffer, logger: IBoundLog): Promise<Note> {
    return await db.transaction(
      async client => {
        const record = await client.queryOne<INoteRecord>(
          'select * from notes where note_hash = $1',
          [noteHash],
        );

        return new Note(client, record);
      },
      { logger },
    );
  }

  public static addSignature(data: Partial<INoteRecord>, address: Address): INoteRecord {
    if (!data.timestamp) {
      data.timestamp = new Date();
    }
    if (!data.effectiveBlockHeight || data.effectiveBlockHeight <= 0) {
      delete data.effectiveBlockHeight;
    }
    data.noteHash = Note.hash(data);
    const keyIndices = Address.getIdentityIndices(address.addressSettings, false);
    data.signature = address.sign(data.noteHash, keyIndices, false);
    return data as INoteRecord;
  }

  public static async all(client: PgClient<DbType.Default>, noteHashes: Buffer[]): Promise<Note[]> {
    return await Promise.all(noteHashes.map(hash => Note.load(hash, client.logger)));
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
