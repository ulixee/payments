import * as moment from 'moment';
import Address from '@ulixee/crypto/lib/Address';
import { UniversalSigner } from '@ulixee/crypto/interfaces/IAddressSettings';
import Identity from '@ulixee/crypto/lib/Identity';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import IMicronoteBatch from '@ulixee/specification/types/IMicronoteBatch';
import * as decamelize from 'decamelize';
import config from '../../config';
import PgClient from '../../utils/PgClient';
import { DbType } from '../../utils/PgPool';
import IBatchState from '../../interfaces/IBatchState';
import MicronoteBatchType from '../../interfaces/MicronoteBatchType';

const batchOpenMinutes = config.micronoteBatch.openMinutes;
const stopNotesMinsBeforeClose = config.micronoteBatch.stopNewNotesMinsBeforeClose;

export default class MicronoteBatch implements IBatchState {
  public get slug(): string {
    return this.data.slug;
  }

  public get address(): string | null {
    return this.data ? this.data.address : null;
  }

  public get identity(): string {
    return this.credentials.identity.bech32;
  }

  public get shouldClose(): boolean {
    return (
      this.data &&
      this.plannedClosingTime !== null &&
      this.plannedClosingTime <= new Date() && // if we are past planned closing time
      this.isClosed === false
    );
  }

  public get shouldSettle(): boolean {
    return this.isClosed === true && this.isSettled === false;
  }

  public get isSettled(): boolean {
    return this.data && !!this.data.settledTime;
  }

  public get plannedClosingTime(): Date | null {
    return this.data ? this.data.plannedClosingTime : null;
  }

  public get settledTime(): Date {
    return this.data?.settledTime;
  }

  public get isClosed(): boolean {
    if (!this.data) return false;
    return !!this.data.closedTime;
  }

  public get isAllowingNewNotes(): boolean {
    if (!this.data) return false;
    if (!this.data.stopNewNotesTime) return true;
    return this.isClosed === false && this.data.stopNewNotesTime > new Date();
  }

  public get type(): MicronoteBatchType {
    return this.data?.type;
  }

  public data?: IMicronoteBatchRecord;
  public credentials: {
    address: Address;
    identity: Identity;
  };

  private sidechainValidationSignature?: Buffer;
  private sidechainIdentity?: string;

  constructor(
    private readonly client: PgClient<DbType.Main>,
    data: IMicronoteBatchRecord,
    address: Address,
  ) {
    this.data = data;
    this.credentials = {
      address,
      identity: address.transferSigners[0],
    };
  }

  public getNoteParams(): IMicronoteBatch {
    if (!this.sidechainValidationSignature) {
      this.sidechainIdentity = config.rootIdentity.bech32;
      const identityHash = sha3(this.identity);
      this.sidechainValidationSignature = config.rootIdentity.sign(identityHash);
    }
    return {
      batchHost: config.baseUrl,
      batchSlug: this.slug,
      isGiftCardBatch: this.data.type === MicronoteBatchType.GiftCard,
      plannedClosingTime: this.plannedClosingTime,
      stopNewNotesTime: this.data.stopNewNotesTime,
      micronoteBatchIdentity: this.identity,
      micronoteBatchAddress: this.address,
      sidechainIdentity: this.sidechainIdentity,
      sidechainValidationSignature: this.sidechainValidationSignature,
    };
  }

  public async recordStateTime(state: keyof IMicronoteBatchRecord): Promise<void> {
    const dbKey = decamelize(state);
    await this.client.update(
      `UPDATE micronote_batches SET ${dbKey} = now() WHERE address = $1 and ${dbKey} is null`,
      [this.data.address],
    );
    this.data[state as any] = new Date();
  }

  public toJSON(): Omit<IMicronoteBatchRecord, 'privateKey'> {
    const { privateKey, ...data } = this.data;
    return data;
  }

  public static async lock(
    client: PgClient<DbType.Main>,
    address: string,
  ): Promise<MicronoteBatch | null> {
    const { rows } = await client.query<IMicronoteBatchRecord>(
      'SELECT * from micronote_batches WHERE address = $1 LIMIT 1 FOR UPDATE',
      [address],
    );

    if (rows.length) {
      const state = MicronoteBatch.fromData(client, rows[0]);
      client.logger.info('Got micronoteBatch from db', { micronoteBatch: state.data });

      return state;
    }

    return null;
  }

  public static async findUnsettled(client: PgClient<DbType.Main>): Promise<MicronoteBatch[]> {
    const records = await client.list<IMicronoteBatchRecord>(
      'SELECT * from micronote_batches WHERE settled_time is null or settled_time >= $1',
      [moment().subtract(10, 'minutes').toDate()],
    );
    return records.map(x => MicronoteBatch.fromData(client, x));
  }

  public static async create(
    client: PgClient<DbType.Main>,
    type: MicronoteBatchType,
  ): Promise<MicronoteBatch> {
    let plannedClose = moment().add(batchOpenMinutes, 'minutes');
    let stopNotes = moment(plannedClose).subtract(stopNotesMinsBeforeClose, 'minutes');
    if (type === MicronoteBatchType.GiftCard) {
      plannedClose = null;
      stopNotes = null;
    }
    const identity = await Identity.create();
    const address = Address.createFromSigningIdentities([identity], {
      signerTypes: [UniversalSigner],
      transferSignatureSettings: 1,
      claimSignatureSettings: 1,
    });

    const prefix = type === MicronoteBatchType.GiftCard ? 'gifts' : 'micro';
    const slug = `${prefix}_${identity.publicKey.toString('hex').substring(0, 8)}`;

    const batch = new MicronoteBatch(
      client,
      {
        slug,
        address: address.bech32,
        privateKey: identity.export(),
        openTime: new Date(),
        type,
        plannedClosingTime: plannedClose?.toDate(),
        stopNewNotesTime: stopNotes?.toDate(),
      },
      address,
    );
    await client.insert<IMicronoteBatchRecord>('micronote_batches', batch.data);
    return batch;
  }

  public static async load(
    client: PgClient<DbType.Main>,
    address: string,
  ): Promise<MicronoteBatch> {
    const record = await client.queryOne<IMicronoteBatchRecord>(
      'SELECT * from micronote_batches WHERE address = $1',
      [address],
    );
    return MicronoteBatch.fromData(client, record);
  }

  public static fromData(
    client: PgClient<DbType.Main>,
    data: IMicronoteBatchRecord,
  ): MicronoteBatch {
    const key = Identity.loadFromPem(data.privateKey);
    return new MicronoteBatch(client, data, MicronoteBatch.singleAddress(key));
  }

  private static singleAddress(identity: Identity): Address {
    return Address.createFromSigningIdentities([identity], {
      signerTypes: [UniversalSigner],
      transferSignatureSettings: 1,
      claimSignatureSettings: 1,
    });
  }
}

export interface IMicronoteBatchRecord {
  address: string;
  slug: string;
  type: MicronoteBatchType;
  privateKey: string;
  openTime: Date;
  plannedClosingTime: Date;
  stopNewNotesTime: Date;
  closedTime?: Date;
  settledTime?: Date;
}
