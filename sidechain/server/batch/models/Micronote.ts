import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer, encodeBuffer } from '@ulixee/commons/lib/bufferUtils';
import { nanoid } from 'nanoid';
import config from '../../config';
import { ConflictError, InvalidParameterError } from '../../utils/errors';
import PgClient from '../../utils/PgClient';
import { DbType } from '../../utils/PgPool';
import MicronoteFunds from './MicronoteFunds';

export default class Micronote {
  public static encodingPrefix = 'mcr';
  public recipients: IMicronoteRecipientsRecord[] = [];

  public get microgonsAllowed(): number {
    return this.data.microgonsAllocated - config.micronoteBatch.settlementFeeMicrogons;
  }

  public data: IMicronoteRecord;

  constructor(
    readonly client: PgClient<DbType.Batch>,
    readonly address: string,
    readonly id?: string,
  ) {}

  public async load(
    includeRecipients = false,
  ): Promise<IMicronoteRecord & { recipients?: IMicronoteRecipientsRecord[] }> {
    const micronote = await this.client.queryOne<IMicronoteRecord>(
      `SELECT
        id,
        client_address,
        funds_id,
        locked_by_identity,
        microgons_allocated,
        locked_time,
        claimed_time,
        is_auditable,
        canceled_time
       FROM micronotes WHERE id=$1`,
      [this.id],
    );
    const returnValue = { ...micronote } as IMicronoteRecord & {
      recipients?: IMicronoteRecipientsRecord[];
    };
    if (includeRecipients === true) {
      this.recipients = await this.client.list<IMicronoteRecipientsRecord>(
        `SELECT *
       FROM micronote_recipients WHERE micronote_id=$1`,
        [this.id],
      );
      returnValue.recipients = this.recipients;
    }
    this.data = micronote;
    return returnValue;
  }

  public async lockForIdentity(identity: string): Promise<boolean> {
    const { lockedByIdentity, fundsId } = await this.client.queryOne(
      'SELECT locked_by_identity, funds_id FROM micronotes where id=$1 FOR UPDATE LIMIT 1',
      [this.id],
    );
    if (lockedByIdentity && identity !== lockedByIdentity) {
      throw new ConflictError('Micronote has already been locked by another Identity');
    }

    this.data ??= {} as any;
    this.data.fundsId = fundsId;
    return await this.client.update(
      'update micronotes set locked_by_identity = $1, locked_time = NOW() where id = $2',
      [identity, this.id],
    );
  }

  public async create(
    batchAddress: string,
    fundsId: number,
    microgonsAllocated: number,
    blockHeight: number,
    isAuditable?: boolean,
  ): Promise<IMicronoteRecord> {
    const nonce = nanoid(16);
    const time = new Date();
    const hash = sha3(concatAsBuffer(blockHeight, nonce, batchAddress, time.toISOString()));

    const id = encodeBuffer(hash, Micronote.encodingPrefix);

    return await this.client.insert<IMicronoteRecord>('micronotes', {
      id,
      clientAddress: this.address,
      blockHeight,
      nonce,
      fundsId,
      microgonsAllocated,
      isAuditable: isAuditable !== false,
      createdTime: time,
      lastUpdatedTime: time,
    });
  }

  /**
   * Ensure there are enough microgons to payout the provided token allocation
   * @param tokenAllocation
   * @returns {Promise.<void>}
   */
  public async validateTokenAllocation(tokenAllocation: {
    [address: string]: number | string;
  }): Promise<void> {
    if (!this.data) {
      await this.load(true);
    }

    const existingAllocated = this.recipients.reduce(
      (total, entry) => total + (entry.microgonsEarned || 0),
      0,
    );

    // make sure payouts is less than allocated microgons
    const allocs = Object.values(tokenAllocation);
    const totalTokens = allocs.reduce(
      (total: number, val): number => total + Number(val),
      0,
    ) as number;

    if (totalTokens + existingAllocated > this.microgonsAllowed) {
      throw new InvalidParameterError(
        'Proposed payout of microgons exceeds note microgons allocated',
        'tokenAllocation',
        {
          existingAllocated,
          microgonsAllocated: this.microgonsAllowed,
          proposedTokenPayout: totalTokens,
        },
      );
    }
  }

  /**
   * Record microgons allocated to all parties. Must sum to less than microgons allocated
   * minus processor fee
   * @param tokenAllocation - map of public key to microgons
   */
  public async recordMicrogonsEarned(tokenAllocation: {
    [address: string]: number | string;
  }): Promise<void> {
    if (!this.data) {
      await this.load(true);
    }
    await this.validateTokenAllocation(tokenAllocation);
    const tokenAllocationPromises = Object.entries(tokenAllocation)
      // filter out any entries with invalid microgons
      .filter(([, microgons]) => microgons && Number.isNaN(Number(microgons)) === false)
      .map(([address, microgons]): Promise<any> => {
        if (this.recipients.find(x => x.address === address)) {
          return this.client.update(
            `UPDATE micronote_recipients
            SET microgons_earned = CAST ($1 AS NUMERIC) + microgons_earned,
              last_updated_time = now()
            WHERE micronote_id = $2 and address = $3`,
            [microgons, this.id, address],
          );
        }
        return this.client.insert<IMicronoteRecipientsRecord>('micronote_recipients', {
          micronoteId: this.id,
          address,
          microgonsEarned: Number(microgons),
          createdTime: new Date(),
        });
      });
    await Promise.all(tokenAllocationPromises);
  }

  public async returnChange(batchAddress: string): Promise<number> {
    if (!this.data) {
      await this.load();
    }
    const { workerfees } = await this.client.queryOne(
      `SELECT coalesce(SUM(microgons_earned),0) as workerfees
       FROM micronote_recipients
       WHERE micronote_id = $1
        AND microgons_earned > 0`,
      [this.id],
    );

    const remaining = this.microgonsAllowed - Number(workerfees ?? 0);

    if (remaining !== 0) {
      const funding = new MicronoteFunds(this.client, batchAddress, this.data.clientAddress);
      await funding.returnHoldTokens(this.data.fundsId, remaining || 0);
    }
    return config.micronoteBatch.settlementFeeMicrogons + Number(workerfees);
  }

  /**
   * Mark this note complete
   */
  public async claim(identity: string): Promise<void> {
    await this.client.update(
      `UPDATE micronotes
      SET claimed_time = now(),
          last_updated_time = now()
      WHERE id = $1
        AND locked_by_identity = $2
        AND claimed_time is null
        AND canceled_time is null`,
      [this.id, identity],
    );
  }
}

export interface IMicronoteRecord {
  id: string;
  fundsId: number;
  blockHeight: number;
  nonce?: Buffer;
  clientAddress: string;
  microgonsAllocated: number;
  guaranteeBlockHeight: number;
  isAuditable: boolean;
  lockedByIdentity?: Buffer;
  lockedTime?: Date;
  claimedTime?: Date;
  canceledTime?: Date;
  createdTime?: Date;
  lastUpdatedTime?: Date;
}

export interface IMicronoteRecipientsRecord {
  micronoteId: Buffer;
  address: string;
  microgonsEarned: number;
  createdTime: Date;
}
