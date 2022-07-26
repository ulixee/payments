import * as moment from 'moment';
import Keyring from '@ulixee/crypto/lib/Keyring';
import { UniversalKey } from '@ulixee/crypto/interfaces/IKeyringSettings';
import Keypair from '@ulixee/crypto/lib/Keypair';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import IMicronoteBatch from '@ulixee/specification/types/IMicronoteBatch';
import * as decamelize from 'decamelize';
import config from '../config';
import PgClient from '../lib/PgClient';
import { DbType } from '../lib/PgPool';

const batchOpenMinutes = config.micronoteBatch.openMinutes;
const stopNotesMinsBeforeClose = config.micronoteBatch.stopNewNotesMinsBeforeClose;

export default class MicronoteBatch {
  public get slug(): string {
    return this.data.slug;
  }

  public get plannedClosingTime(): Date | null {
    return this.data ? this.data.plannedClosingTime : null;
  }

  public get address(): string | null {
    return this.data ? this.data.address : null;
  }

  public get shouldClose(): boolean {
    return (
      this.data &&
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

  public get isClosed(): boolean {
    if (!this.data) return false;
    return !!this.data.closedTime;
  }

  public get isAllowingNewNotes(): boolean {
    if (!this.data) return false;
    return this.isClosed === false && this.data.stopNewNotesTime > new Date();
  }

  public data?: IMicronoteBatchRecord;
  public keyring: Keyring;
  public identity: Keypair;
  private sidechainValidationSignature?: Buffer;
  private sidechainPublicKey?: Buffer;

  constructor(
    private readonly client: PgClient<DbType.Default>,
    data: IMicronoteBatchRecord,
    keyring: Keyring,
  ) {
    this.data = data;
    this.keyring = keyring;
    this.identity = keyring.transferKeys[0];
  }

  public getNoteParams(): IMicronoteBatch {
    if (!this.sidechainValidationSignature) {
      this.sidechainPublicKey = config.rootKey.publicKey;
      const identityHash = sha3(this.identity.publicKey);
      this.sidechainValidationSignature = config.rootKey.sign(identityHash);
    }
    return {
      batchSlug: this.slug,
      micronoteBatchPublicKey: this.identity.publicKey,
      micronoteBatchAddress: this.address,
      sidechainPublicKey: this.sidechainPublicKey,
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

  public static async lock(
    client: PgClient<DbType.Default>,
    address: string,
  ): Promise<MicronoteBatch | null> {
    const { rows } = await client.query<IMicronoteBatchRecord>(
      'SELECT * from micronote_batches WHERE address = $1 LIMIT 1 FOR UPDATE',
      [address],
    );

    if (rows.length) {
      const state = MicronoteBatch.fromData(client, rows[0]);
      client.logger.info('Got micronoteBatch from db', { state: state.data, rows });

      return state;
    }

    return null;
  }

  public static async findUnsettled(client: PgClient<DbType.Default>): Promise<MicronoteBatch[]> {
    const records = await client.list<IMicronoteBatchRecord>(
      'SELECT * from micronote_batches WHERE settled_time is null or settled_time >= $1',
      [moment().subtract(10, 'minutes').toDate()],
    );
    return records.map(x => MicronoteBatch.fromData(client, x));
  }

  public static async create(client: PgClient<DbType.Default>): Promise<MicronoteBatch> {
    const plannedClose = moment().add(batchOpenMinutes, 'minutes');
    const stopNotes = moment(plannedClose).subtract(stopNotesMinsBeforeClose, 'minutes');
    const key = await Keypair.create();
    const keyring = Keyring.createFromKeypairs([key], {
      keyTypes: [UniversalKey],
      transferSignatureSettings: 1,
      claimSignatureSettings: 1,
    });
    const batch = new MicronoteBatch(
      client,
      {
        slug: key.publicKey.toString('hex').substring(0, 10),
        address: keyring.address,
        privateKey: key.export(),
        openTime: new Date(),
        plannedClosingTime: plannedClose.toDate(),
        stopNewNotesTime: stopNotes.toDate(),
      },
      keyring,
    );
    await client.insert<IMicronoteBatchRecord>('micronote_batches', batch.data);
    return batch;
  }

  public static async load(
    client: PgClient<DbType.Default>,
    address: string,
  ): Promise<MicronoteBatch> {
    const record = await client.queryOne('SELECT * from micronote_batches WHERE address = $1', [
      address,
    ]);
    return MicronoteBatch.fromData(client, record);
  }

  public static fromData(
    client: PgClient<DbType.Default>,
    data: IMicronoteBatchRecord,
  ): MicronoteBatch {
    const key = Keypair.loadFromPem(data.privateKey);
    return new MicronoteBatch(client, data, MicronoteBatch.singleKeyring(key));
  }

  private static singleKeyring(key: Keypair): Keyring {
    return Keyring.createFromKeypairs([key], {
      keyTypes: [UniversalKey],
      transferSignatureSettings: 1,
      claimSignatureSettings: 1,
    });
  }
}

export interface IMicronoteBatchRecord {
  address: string;
  slug: string;
  privateKey: string;
  openTime: Date;
  plannedClosingTime: Date;
  stopNewNotesTime: Date;
  closedTime?: Date;
  settledTime?: Date;
}
