import { randomBytes } from 'crypto';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import config from '../config';
import BlockManager from '../lib/BlockManager';
import { ConflictError, InvalidParameterError } from '../lib/errors';
import PgClient from '../lib/PgClient';
import { DbType } from '../lib/PgPool';
import MicronoteBatch from './MicronoteBatch';
import MicronoteFunds from './MicronoteFunds';

export default class Micronote {
  public recipients: IMicronoteRecipientsRecord[] = [];
  private data: IMicronoteRecord;

  constructor(
    readonly client: PgClient<DbType.Batch>,
    readonly address: string,
    readonly id?: Buffer,
  ) {}

  public async load(
    includeRecipients = false,
  ): Promise<IMicronoteRecord & { recipients?: IMicronoteRecipientsRecord[] }> {
    const micronote = await this.client.queryOne<IMicronoteRecord>(
      `SELECT
        id,
        client_address,
        funds_id,
        locked_by_public_key,
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

  public async lockForPublicKey(publicKey: Buffer): Promise<boolean> {
    const { lockedByPublicKey } = await this.client.queryOne(
      'SELECT locked_by_public_key FROM micronotes where id=$1 FOR UPDATE LIMIT 1',
      [this.id],
    );
    if (lockedByPublicKey && !publicKey.equals(lockedByPublicKey)) {
      throw new ConflictError('Note has already been locked by another wallet');
    }
    return await this.client.update(
      'update micronotes set locked_by_public_key = $1, locked_time = NOW() where id = $2',
      [publicKey, this.id],
    );
  }

  get microgonsAllowed(): number {
    return this.data.microgonsAllocated - config.micronoteBatch.settlementFeeMicrogons;
  }

  public async create(
    batch: MicronoteBatch,
    fundsId: number,
    microgonsAllocated: number,
    isAuditable?: boolean,
  ): Promise<IMicronoteRecord> {
    const nonce = randomBytes(16);
    const blockHeight = await BlockManager.currentBlockHeight();
    const time = new Date();

    return this.client.insert<IMicronoteRecord>('micronotes', {
      id: sha3([blockHeight, nonce.toString('base64'), batch.address, time.toISOString()].join('')),
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
          microgonsAllocated: this.microgonsAllowed.toString(),
          proposedTokenPayout: totalTokens,
        },
      );
    }
  }

  /**
   * Record microgons allocated to all parties.  Must sum to less than microgons allocated
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

  public async returnChange(batch: MicronoteBatch): Promise<number> {
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
      const funding = new MicronoteFunds(this.client, batch, this.data.clientAddress);
      await funding.returnHoldTokens(this.data.fundsId, remaining || 0);
    }
    return config.micronoteBatch.settlementFeeMicrogons + Number(workerfees);
  }

  /**
   * Mark this note complete
   */
  public async claim(publicKey: Buffer): Promise<void> {
    await this.client.update(
      `UPDATE micronotes
      SET claimed_time = now(),
          last_updated_time = now()
      WHERE id = $1
        AND locked_by_public_key = $2
        AND claimed_time is null
        AND canceled_time is null`,
      [this.id, publicKey],
    );
  }
}

export interface IMicronoteRecord {
  id: Buffer;
  fundsId: number;
  blockHeight: number;
  nonce?: Buffer;
  clientAddress: string;
  microgonsAllocated: number;
  guaranteeBlockHeight: number;
  isAuditable: boolean;
  lockedByPublicKey?: Buffer;
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
