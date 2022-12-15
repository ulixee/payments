import { nanoid, customAlphabet } from 'nanoid';
import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';
import { ConflictError } from '@ulixee/payment-utils/lib/errors';
import Ed25519 from '@ulixee/crypto/lib/Ed25519';
import GiftCards from '@ulixee/sidechain/lib/GiftCards';

const idNanoid = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_',
  12,
);

export default class GiftCard {
  constructor(
    readonly client: PgClient<DbType.Batch>,
    public data?: IGiftCardRecord,
    public id?: string,
  ) {}

  public async lock(): Promise<void> {
    this.data = await this.client.queryOne<IGiftCardRecord>(
      `select * from gift_cards where id=$1 LIMIT 1 FOR UPDATE`,
      [this.id],
    );
  }

  public async load(): Promise<IGiftCardRecord> {
    this.data = await this.client.queryOne<IGiftCardRecord>(
      `select * from gift_cards where id=$1 LIMIT 1`,
      [this.id],
    );
    return this.data;
  }

  public async create(record: Partial<IGiftCardRecord>): Promise<GiftCard> {
    const giftCardId = idNanoid();
    const keypair = await Ed25519.create();
    const redemptionKey = GiftCards.encodeGiftCardRedemptionKey(keypair.privateKey);
    this.id = giftCardId;
    const time = new Date();
    this.data = {
      id: giftCardId,
      redemptionKey,
      issuedMicrogons: record.issuedMicrogons,
      issuerIdentities: record.issuerIdentities,
      issuerSignatures: record.issuerSignatures,
      createdTime: time,
      lastUpdatedTime: time,
    };

    await this.client.insert<IGiftCardRecord>('gift_cards', this.data);
    await this.credit(record.issuedMicrogons);
    return this;
  }

  public async getBalance(): Promise<number> {
    const [
      {
        rows: [{ balance }],
      },
    ] = await Promise.all([
      this.client.preparedQuery<{ balance: bigint }>({
        text: `SELECT -COALESCE(SUM(microgons_debited),0) as balance FROM gift_card_transactions 
        where gift_card_id=$1 and canceled_time is null`,
        name: 'gift_card_balance_query',
        values: [this.id],
      }),
    ]);
    return Number(balance);
  }

  public async credit(microgons: number): Promise<IGiftCardTransactionRecord> {
    return await this.client.insert<IGiftCardTransactionRecord>('gift_card_transactions', {
      id: nanoid(32),
      microgonsDebited: -microgons,
      giftCardId: this.id,
      createdTime: new Date(),
      settledTime: new Date(),
    });
  }

  public async hold(microgons: number): Promise<IGiftCardTransactionRecord> {
    const id = nanoid(32);
    const now = new Date();
    return await this.client.insert<IGiftCardTransactionRecord>('gift_card_transactions', {
      id,
      microgonsDebited: microgons,
      giftCardId: this.id,
      holdTime: now,
      createdTime: now,
    });
  }

  public async getHoldTransaction(holdId: string): Promise<IGiftCardTransactionRecord> {
    return await this.client.queryOne<IGiftCardTransactionRecord>(
      `select * from gift_card_transactions where id=$1`,
      [holdId],
    );
  }

  public async settleHold(holdId: string, microgons: number): Promise<void> {
    const transaction = await this.client.queryOne<IGiftCardTransactionRecord>(
      `select * from gift_card_transactions where id=$1 LIMIT 1 FOR UPDATE`,
      [holdId],
    );
    if (transaction.settledTime) throw new ConflictError('This transaction was already settled');

    await this.client.update(
      `update gift_card_transactions set microgons_debited=$2, settled_time=$3 where id=$1 and settled_time is null`,
      [holdId, microgons, new Date()],
    );
  }
}

export interface IGiftCardRecord {
  id: string;
  issuedMicrogons: number;
  redemptionKey: string;
  issuerIdentities: string[];
  issuerSignatures: Buffer[];
  createdTime: Date;
  lastUpdatedTime: Date;
}

export interface IGiftCardTransactionRecord {
  id: string;
  giftCardId: string;
  microgonsDebited: number;
  holdTime?: Date;
  canceledTime?: Date;
  settledTime?: Date;
  createdTime: Date;
}
