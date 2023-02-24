import { sha256 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer, encodeBuffer } from '@ulixee/commons/lib/bufferUtils';
import { nanoid } from 'nanoid';
import { ConflictError, InvalidParameterError } from '@ulixee/payment-utils/lib/errors';
import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';
import config from '../../config';
import MicronoteFunds from './MicronoteFunds';

export default class Micronote {
  public static encodingPrefix = 'mcr';
  public disbursements: IMicronoteDisbursementssRecord[] = [];

  public data: IMicronoteRecord;

  constructor(
    readonly client: PgClient<DbType.Batch>,
    readonly address: string,
    readonly id?: string,
  ) {}

  public async load(options?: {
    includeDisbursements: boolean;
  }): Promise<IMicronoteRecord & { recipients?: IMicronoteDisbursementssRecord[] }> {
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
      recipients?: IMicronoteDisbursementssRecord[];
    };
    if (options?.includeDisbursements === true) {
      this.disbursements = await this.client.list<IMicronoteDisbursementssRecord>(
        `SELECT *
       FROM micronote_disbursements WHERE micronote_id=$1`,
        [this.id],
      );
      returnValue.recipients = this.disbursements;
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
      await this.client.queryOne<Partial<IMicronoteRecord>>(
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
    fundsId: string,
    microgonsAllocated: number,
    blockHeight: number,
    isAuditable?: boolean,
  ): Promise<IMicronoteRecord> {
    const nonce = nanoid(16);
    const holdAuthorizationCode = nanoid(16);
    const time = new Date();
    const hash = sha256(concatAsBuffer(blockHeight, nonce, batchAddress, time.toISOString()));

    const id = encodeBuffer(hash, Micronote.encodingPrefix);

    const micronote = await this.client.insert<IMicronoteRecord>('micronotes', {
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

    await this.client.batchInsert<IMicronoteTransactionsRecord>('micronote_transactions', [
      {
        id: nanoid(30),
        micronoteId: id,
        microgons: microgonsAllocated,
        identity: this.address,
        type: 'fund',
        fundsId,
        createdTime: new Date(),
      },
      {
        id: nanoid(30),
        micronoteId: id,
        microgons: -config.micronoteBatch.settlementFeeMicrogons,
        identity: batchAddress,
        type: 'fee',
        fundsId,
        createdTime: new Date(),
      },
    ]);

    return micronote;
  }

  public async getBalance(): Promise<number> {
    const { rows } = await this.client.preparedQuery<{ balance: number }>({
      text: `SELECT SUM(microgons) as balance FROM micronote_transactions WHERE micronote_id = $1`,
      name: 'micronote_balance_query',
      values: [this.id],
    });
    if (rows.length) {
      return Number(rows[0].balance ?? 0);
    }
    return 0;
  }

  public async holdFunds(
    identity: string,
    microgons: number,
  ): Promise<{ accepted: boolean; remainingBalance: number; holdId?: string }> {
    const id = nanoid(30);
    const balance = await this.getBalance();
    if (balance - microgons < 0) {
      return { accepted: false, remainingBalance: balance };
    }

    await this.client.insert<IMicronoteTransactionsRecord>('micronote_transactions', {
      id,
      micronoteId: this.id,
      microgons: -microgons,
      identity,
      type: 'hold',
      fundsId: this.data.fundsId,
      createdTime: new Date(),
    });

    return {
      accepted: true,
      remainingBalance: balance - microgons,
      holdId: id,
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
      await this.load({ includeDisbursements: true });
    }

    const {
      rows: [hold],
    } = await this.client.query<IMicronoteTransactionsRecord>(
      'select * from micronote_transactions where micronote_id=$1 and id=$2 FOR UPDATE LIMIT 1',
      [this.id, holdId],
    );
    if (!hold || hold.identity !== holderIdentity)
      throw new Error('The micronote hold could not be found.');
    // don't allow another settle
    const {
      rows: [settle],
    } = await this.client.query<{ id: string }>(
      'select id from micronote_transactions where micronote_id=$1 and parent_id=$2 LIMIT 1',
      [this.id, holdId],
    );
    if (settle) throw new Error('This micronote hold has already been settled.');

    const microgonsDistributed = Object.values(tokenAllocation).reduce((a, b) => a + b, 0);

    // if exceeding hold amount, need to check total funds
    if (Math.abs(hold.microgons) < microgonsDistributed) {
      await this.validateHoldIsAllowed(hold, microgonsDistributed);
    }

    if (!this.data.hasSettlements) {
      await this.client.update('update micronotes set has_settlements=true where id=$1', [this.id]);
    }

    // reverse hold and insert settlement
    await this.client.batchInsert<IMicronoteTransactionsRecord>('micronote_transactions', [
      {
        id: nanoid(30),
        micronoteId: this.id,
        fundsId: this.data.fundsId,
        parentId: holdId,
        type: 'reversal',
        microgons: -hold.microgons,
        identity: holderIdentity,
        createdTime: new Date(),
      },
      {
        id: nanoid(30),
        micronoteId: this.id,
        fundsId: this.data.fundsId,
        parentId: holdId,
        type: 'settle',
        microgons: -microgonsDistributed,
        identity: holderIdentity,
        createdTime: new Date(),
      },
    ]);

    const tokenAllocationPromises: Promise<any>[] = [];
    for (const [address, microgons] of Object.entries(tokenAllocation)) {
      let promise: Promise<any>;
      if (this.disbursements.find(x => x.address === address)) {
        promise = this.client.update(
          `UPDATE micronote_disbursements
            SET microgons_earned = CAST ($1 AS NUMERIC) + microgons_earned,
              last_updated_time = now()
            WHERE micronote_id = $2 and address = $3`,
          [microgons, this.id, address],
        );
      } else {
        promise = this.client.insert<IMicronoteDisbursementssRecord>('micronote_disbursements', {
          micronoteId: this.id,
          address,
          microgonsEarned: microgons,
          createdTime: new Date(),
        });
      }
      tokenAllocationPromises.push(promise);
    }
    await Promise.all(tokenAllocationPromises);
  }

  public async returnChange(batchAddress: string): Promise<number> {
    if (!this.data) {
      await this.load();
    }
    let { earnings } = await this.client.queryOne(
      `SELECT SUM(microgons_earned) as earnings
       FROM micronote_disbursements
       WHERE micronote_id = $1
        AND microgons_earned > 0`,
      [this.id],
    );
    earnings = Number(earnings ?? 0);

    // reverse pending holds
    const allTransactions = await this.client.list<IMicronoteTransactionsRecord>(
      'select * from micronote_transactions where micronote_id=$1',
      [this.id],
    );
    const holds = allTransactions.filter(x => x.type === 'hold');
    for (const hold of holds) {
      const reversal = allTransactions.find(
        x => (x.type === 'reversal' || x.type === 'cancel') && x.parentId === hold.id,
      );
      if (!reversal) {
        await this.client.insert<IMicronoteTransactionsRecord>(`micronote_transactions`, {
          id: nanoid(30),
          micronoteId: this.id,
          fundsId: this.data.fundsId,
          parentId: hold.id,
          type: 'cancel',
          microgons: -hold.microgons,
          identity: batchAddress,
          createdTime: new Date(),
        });
      }
    }

    const remainingBalance = await this.getBalance();
    const finalCost = this.data.microgonsAllocated - remainingBalance;

    if (
      remainingBalance !==
      this.data.microgonsAllocated - earnings - config.micronoteBatch.settlementFeeMicrogons
    ) {
      console.warn(`There's an accounting error in this micronote (${this.id})`, {
        allTransactions,
        remainingBalance,
        allocated: this.data.microgonsAllocated,
        earnings,
      });
      throw new Error(
        `There's an accounting error in this micronote (${this.id}). Remaining balance (${remainingBalance}) !== allocated(${this.data.microgonsAllocated}) - earnings(${earnings}) - fee(${config.micronoteBatch.settlementFeeMicrogons})`,
      );
    }

    await this.client.insert<IMicronoteTransactionsRecord>(`micronote_transactions`, {
      id: nanoid(30),
      micronoteId: this.id,
      fundsId: this.data.fundsId,
      parentId: allTransactions.find(x => x.type === 'fund').id,
      type: 'change',
      microgons: -remainingBalance,
      identity: batchAddress,
      createdTime: new Date(),
    });

    if (remainingBalance !== 0) {
      const funding = new MicronoteFunds(this.client, batchAddress, this.data.clientAddress);
      await funding.returnHoldTokens(this.data.fundsId, remainingBalance);
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

  private async validateHoldIsAllowed(
    hold: IMicronoteTransactionsRecord,
    settledMicrogons: number,
  ): Promise<void> {
    const transactionBalance = await this.getBalance();
    const sum = transactionBalance + Math.abs(hold.microgons) - settledMicrogons;
    if (sum < 0) {
      throw new InvalidParameterError(
        'Proposed payout of microgons exceeds micronote allocation',
        'tokenAllocation',
        {
          heldMicrogons: Math.abs(hold.microgons),
          balance: transactionBalance,
          proposedTokenPayout: settledMicrogons,
        },
      );
    }
  }
}

export interface IMicronoteRecord {
  id: string;
  fundsId: string;
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

export interface IMicronoteTransactionsRecord {
  id: string;
  fundsId: string;
  micronoteId: string;
  parentId?: string;
  type: 'hold' | 'reversal' | 'settle' | 'fund' | 'fee' | 'cancel' | 'change';
  identity: string;
  microgons: number;
  createdTime: Date;
}

export interface IMicronoteDisbursementssRecord {
  micronoteId: string;
  address: string;
  microgonsEarned: number;
  createdTime: Date;
}
