import { INote, NoteType } from '@ulixee/specification';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import ArgonUtils from '@ulixee/sidechain/lib/ArgonUtils';
import {
  ConflictError,
  InvalidParameterError,
  MicronoteFundsNeededError,
  NotFoundError,
} from '@ulixee/payment-utils/lib/errors';
import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';
import config from '../../config';

export default class MicronoteFunds {
  public id: number;
  private logger: IBoundLog;
  constructor(
    readonly client: PgClient<DbType.Batch>,
    readonly batchAddress: string,
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
      throw new NotFoundError('The address provided could not found', this.clientAddress);
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
        Math.max(
          Number(config.micronoteBatch.minimumFundingCentagons),
          Number(ArgonUtils.microgonsToCentagons(microgons, false)),
        ),
      );
    }
    return await this.client.queryOne<{
      guaranteeBlockHeight: number;
      microgonsRemaining: number;
    }>(
      `select 
      (microgons - microgons_allocated) as microgons_remaining,
      guarantee_block_height 
      from micronote_funds where id=$1`,
      [fundsId],
    );
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

  public async find(microgons: number): Promise<{
    microgonsRemaining: number;
    fundsId: number;
    redeemableWithAddresses?: string[];
  }> {
    const params = [this.clientAddress, microgons];
    const { rows: funds } = await this.client.query<{
      fundsId: number;
      microgonsRemaining: number;
      redeemableWithAddresses?: string[];
    }>(
      `SELECT id as funds_id, 
        (microgons - microgons_allocated) as microgons_remaining,
        allowed_recipient_addresses
      FROM micronote_funds 
        WHERE address = $1 and microgons >= (microgons_allocated + $2)`,
      params,
    );

    if (!funds.length) {
      return null;
    }

    const [fund] = funds;
    this.logger.info('Got MicronoteBatch funding back', {
      microgons,
      isEnough: fund.microgonsRemaining >= microgons,
      first: fund,
    });
    return fund;
  }

  public async createFromNote(note: INote): Promise<IMicronoteFundsRecord> {
    const { fromAddress, toAddress, centagons } = note;

    if (fromAddress !== this.clientAddress) {
      throw new InvalidParameterError(
        'The source public key for the provided note does not match the requestor',
      );
    }

    if (note.type !== NoteType.micronoteFunds) {
      throw new InvalidParameterError(
        'This MicronoteBatch funding note must have a type of "micronoteFunds"',
        'type',
        {
          type: NoteType[note.type],
        },
      );
    }

    if (toAddress !== this.batchAddress) {
      throw new InvalidParameterError(
        'The note to create this MicronoteBatch sent the microgons to a public key that is NOT the current MicronoteBatch',
        'address',
        {
          micronoteBatchAddress: this.batchAddress,
          destinationAddress: toAddress,
        },
      );
    }

    const minFunding = config.micronoteBatch.minimumFundingCentagons;
    if (centagons < minFunding) {
      throw new InvalidParameterError(
        `The minimum funding for a batch is ${minFunding} centagons.`,
        'centagons',
        { centagons, minFunding },
      );
    }

    const fund = await MicronoteFunds.createFromNote(this.client, note);
    this.id = fund.id;
    return fund;
  }

  public static async createFromNote(
    client: PgClient<DbType.Batch>,
    note: INote,
  ): Promise<IMicronoteFundsRecord> {
    const { fromAddress, centagons, noteHash, timestamp, guaranteeBlockHeight } = note;
    return await client.insertWithId('micronote_funds', {
      address: fromAddress,
      noteHash,
      microgons: ArgonUtils.centagonsToMicrogons(centagons),
      microgonsAllocated: 0,
      createdTime: timestamp,
      lastUpdatedTime: new Date(),
      guaranteeBlockHeight,
    });
  }

  public static async findWithIds(
    client: PgClient<DbType.Batch>,
    ids: number[],
  ): Promise<IMicronoteFundsRecord[]> {
    if (!ids.length) return [];
    return await client.list(`select * from micronote_funds where id = ANY ($1)`, [ids]);
  }

  public static async verifyAllowedPaymentAddresses(
    client: PgClient<DbType.Batch>,
    id: number,
    addresses: string[],
  ): Promise<boolean> {
    const fund = await client.queryOne<Pick<IMicronoteFundsRecord, 'allowedRecipientAddresses'>>(
      `select allowed_recipient_addresses from micronote_funds where id = $1 LIMIT 1`,
      [id],
    );
    for (const address of addresses) {
      if (
        fund.allowedRecipientAddresses?.length &&
        !fund.allowedRecipientAddresses.includes(address)
      ) {
        throw new Error(
          `This MicronoteFund can't be redeemed with one of the addresses you requested (${address})`,
        );
      }
    }
    return true;
  }

  public static async findWithAddress(
    client: PgClient<DbType.Batch>,
    address: string,
  ): Promise<IMicronoteFundsRecord[]> {
    return await client.list(`select * from micronote_funds where address = $1`, [address]);
  }
}

export interface IMicronoteFundsRecord {
  id: number;
  address: string;
  noteHash?: Buffer;
  guaranteeBlockHeight: number;
  allowedRecipientAddresses?: string[];
  microgons: number;
  microgonsAllocated: number;
  createdTime: Date;
  lastUpdatedTime: Date;
}
