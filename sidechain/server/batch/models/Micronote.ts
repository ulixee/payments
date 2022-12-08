import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer, encodeBuffer } from '@ulixee/commons/lib/bufferUtils';
import { nanoid } from 'nanoid';
import {
  ConflictError,
  InsufficientFundsError,
  InvalidParameterError,
} from '@ulixee/payment-utils/lib/errors';
import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';
import ArgonUtils from '@ulixee/sidechain/lib/ArgonUtils';
import config from '../../config';
import MicronoteFunds from './MicronoteFunds';

export default class Micronote {
  public static encodingPrefix = 'mcr';
  public recipients: IMicronoteRecipientsRecord[] = [];
  public holds: IMicronoteHoldsRecord[] = [];

  public get microgonsAllowed(): number {
    return this.data.microgonsAllocated - config.micronoteBatch.settlementFeeMicrogons;
  }

  public data: IMicronoteRecord;

  constructor(
    readonly client: PgClient<DbType.Batch>,
    readonly address: string,
    readonly id?: string,
  ) {}

  public async load(options?: {
    includeRecipients: boolean;
    includeHolds: boolean;
  }): Promise<IMicronoteRecord & { recipients?: IMicronoteRecipientsRecord[] }> {
    const micronote = await this.client.queryOne<IMicronoteRecord>(
      `SELECT
        id,
        client_address,
        funds_id,
        hold_authorization_code,
        locked_by_identity,
        microgons_allocated,
        locked_time,
        finalized_time,
        has_settlements,
        is_auditable,
        canceled_time
       FROM micronotes WHERE id=$1`,
      [this.id],
    );
    const returnValue = { ...micronote } as IMicronoteRecord & {
      recipients?: IMicronoteRecipientsRecord[];
    };
    if (options?.includeRecipients === true) {
      this.recipients = await this.client.list<IMicronoteRecipientsRecord>(
        `SELECT *
       FROM micronote_recipients WHERE micronote_id=$1`,
        [this.id],
      );
      returnValue.recipients = this.recipients;
    }
    if (options?.includeHolds === true) {
      this.holds = await this.client.list(`SELECT * FROM micronote_holds WHERE micronote_id=$1`, [
        this.id,
      ]);
    }
    this.data = micronote;
    return returnValue;
  }

  public async lock(): Promise<IMicronoteRecord> {
    this.data = await this.client.queryOne(
      `select * from micronotes where id=$1 LIMIT 1 FOR UPDATE`,
      [this.id],
    );
    return this.data;
  }

  public async lockForIdentity(identity: string): Promise<boolean> {
    const { lockedByIdentity, fundsId, holdAuthorizationCode, microgonsAllocated, finalizedTime } =
      await this.client.queryOne(
        'SELECT microgons_allocated, locked_by_identity, finalized_time, funds_id, hold_authorization_code FROM micronotes where id=$1 FOR UPDATE LIMIT 1',
        [this.id],
      );
    if (lockedByIdentity && identity !== lockedByIdentity) {
      throw new ConflictError('Micronote has already been locked by another Identity');
    }

    this.data ??= {} as any;
    this.data.fundsId = fundsId;
    this.data.holdAuthorizationCode = holdAuthorizationCode;
    this.data.microgonsAllocated = microgonsAllocated;
    this.data.finalizedTime = finalizedTime;
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
    const holdAuthorizationCode = nanoid(16);
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
      holdAuthorizationCode,
      isAuditable: isAuditable !== false,
      hasSettlements: false,
      createdTime: time,
      lastUpdatedTime: time,
    });
  }

  public async holdFunds(
    identity: string,
    microgons: number,
  ): Promise<{ accepted: boolean; remainingBalance: number; holdId?: string }> {
    const holdId = nanoid(16);
    const holds = await this.client.list<IMicronoteHoldsRecord>(
      `select * from micronote_holds where micronote_id=$1`,
      [this.id],
    );
    const balance = holds.reduce(
      (sum, hold) => sum + (hold.microgonsSettled ?? hold.microgonsHeld),
      0,
    );

    if (balance + microgons > this.microgonsAllowed) {
      return { accepted: false, remainingBalance: this.microgonsAllowed - balance };
    }

    await this.client.insert<IMicronoteHoldsRecord>('micronote_holds', {
      micronoteId: this.id,
      holdId,
      microgonsHeld: microgons,
      identity,
      holdTime: new Date(),
      lastUpdatedTime: new Date(),
      createdTime: new Date(),
    });

    return {
      accepted: true,
      remainingBalance: this.microgonsAllowed - balance - microgons,
      holdId,
    };
  }

  public async recordMicrogonsEarned(
    holdId: string,
    holderIdentity: string,
    tokenAllocation: {
      [address: string]: number;
    },
  ): Promise<void> {
    if (!this.data) {
      await this.load({ includeHolds: true, includeRecipients: true });
    }

    const hold = this.holds.find(x => x.holdId === holdId);
    if (!hold || hold.identity !== holderIdentity)
      throw new Error('The micronote hold could not be found.');
    // don't allow another settle
    if (hold.settledTime) throw new Error('This micronote hold has already been settled.');

    const microgonsDistributed = Object.values(tokenAllocation).reduce((a, b) => a + b, 0);

    // if exceeding hold amount, need to check total funds
    if (hold.microgonsHeld < microgonsDistributed) {
      this.validateHoldIsAllowed(hold, microgonsDistributed);
    }

    if (!this.data.hasSettlements) {
      await this.client.update('update micronotes set has_settlements=true where id=$1', [this.id]);
    }
    await this.client.update(
      `update micronote_holds set settled_time=$1, microgons_settled=$2 where micronote_id=$3 and hold_id=$4 and settled_time is null`,
      [new Date(), microgonsDistributed, this.id, holdId],
    );

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
    let { earnings } = await this.client.queryOne(
      `SELECT coalesce(SUM(microgons_earned),0) as earnings
       FROM micronote_recipients
       WHERE micronote_id = $1
        AND microgons_earned > 0`,
      [this.id],
    );
    earnings = Number(earnings ?? 0);

    let remaining = this.microgonsAllowed - earnings;

    // if no earnings, can't take fee
    if (earnings === 0) {
      remaining = this.data.microgonsAllocated;
    }

    if (remaining !== 0) {
      const funding = new MicronoteFunds(this.client, batchAddress, this.data.clientAddress);
      await funding.returnHoldTokens(this.data.fundsId, remaining || 0);
    }

    let finalCost = earnings;
    if (finalCost > 0) {
      finalCost += config.micronoteBatch.settlementFeeMicrogons;
    }

    return finalCost;
  }

  public async markFinal(identity: string): Promise<void> {
    await this.client.update(
      `UPDATE micronotes
      SET finalized_time = now(),
          last_updated_time = now()
      WHERE id = $1
        AND locked_by_identity = $2
        AND finalized_time is null
        AND canceled_time is null`,
      [this.id, identity],
    );
  }

  /**
   * Ensure there are enough microgons to payout the provided token allocation
   */
  private validateTokenAllocation(tokenAllocation: { [address: string]: number | string }): void {
    const existingAllocated = this.recipients.reduce(
      (total, entry) => total + (entry.microgonsEarned || 0),
      0,
    );

    // make sure payouts is less than allocated microgons
    const allocs = Object.values(tokenAllocation);
    const totalTokens = allocs.reduce((total: number, val) => total + Number(val), 0) as number;

    if (totalTokens + existingAllocated > this.microgonsAllowed) {
      throw new InvalidParameterError(
        'Proposed payout of microgons exceeds micronote allocation',
        'tokenAllocation',
        {
          existingAllocated,
          microgonsAllocated: this.microgonsAllowed,
          proposedTokenPayout: totalTokens,
        },
      );
    }
  }

  private validateHoldIsAllowed(hold: IMicronoteHoldsRecord, settledMicrogons: number): void {
    let sum = 0;
    for (const holdRecord of this.holds) {
      if (holdRecord.holdId === hold.holdId) {
        sum += settledMicrogons;
      } else {
        sum += holdRecord.microgonsSettled ?? holdRecord.microgonsHeld;
      }
    }
    if (sum > this.microgonsAllowed) {
      throw new InvalidParameterError(
        'Proposed payout of microgons exceeds micronote allocation',
        'tokenAllocation',
        {
          existingAllocated: sum,
          microgonsAllocated: this.microgonsAllowed,
          proposedTokenPayout: settledMicrogons,
        },
      );
    }
  }
}

export interface IMicronoteRecord {
  id: string;
  fundsId: number;
  blockHeight: number;
  nonce?: string;
  clientAddress: string;
  microgonsAllocated: number;
  guaranteeBlockHeight: number;
  isAuditable: boolean;
  lockedByIdentity?: string;
  lockedTime?: Date;
  holdAuthorizationCode: string;
  hasSettlements: boolean;
  finalizedTime?: Date;
  canceledTime?: Date;
  createdTime?: Date;
  lastUpdatedTime?: Date;
}

export interface IMicronoteHoldsRecord {
  micronoteId: string;
  holdId: string;
  holdTime?: Date;
  identity: string;
  settledTime?: Date;
  microgonsHeld: number;
  microgonsSettled: number;
  createdTime?: Date;
  lastUpdatedTime?: Date;
}

export interface IMicronoteRecipientsRecord {
  micronoteId: string;
  address: string;
  microgonsEarned: number;
  createdTime: Date;
}
