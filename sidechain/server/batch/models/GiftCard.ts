import { nanoid } from 'nanoid';
import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';

export default class GiftCard {
  constructor(
    readonly client: PgClient<DbType.Batch>,
    public data?: IGiftCardRecord,
    public id?: string,
  ) {}

  public async claim(address: string): Promise<GiftCard> {
    this.data.claimAddress = address;
    await this.client.update(
      `UPDATE gift_cards
      SET claim_address = $2,
          claimed_time = now(),
          last_updated_time = now()
      WHERE id = $1
        AND claim_address is null
        AND claimed_time is null`,
      [this.id, address],
    );
    return this;
  }

  public async lock(): Promise<void> {
    this.data = await this.client.queryOne<IGiftCardRecord>(
      `select * from gift_cards where id=$1 LIMIT 1 FOR UPDATE`,
      [this.id],
    );
  }

  public async saveFund(fundsId: number): Promise<void> {
    this.data.fundsId = fundsId;
    await this.client.update(
      `UPDATE gift_cards set funds_id = $1, funded_time = NOW() where id=$2 and funds_id is null`,
      [fundsId, this.id],
    );
  }

  public async create(record: Partial<IGiftCardRecord>): Promise<GiftCard> {
    const giftCardId = nanoid(32);
    this.id = giftCardId;
    const time = new Date();
    this.data = {
      id: giftCardId,
      microgons: record.microgons,
      redeemableWithAddresses: record.redeemableWithAddresses,
      redeemableAddressSignatures: record.redeemableAddressSignatures,
      createdTime: time,
      lastUpdatedTime: time,
    };

    await this.client.insert<IGiftCardRecord>('gift_cards', this.data);
    return this;
  }
}

export interface IGiftCardRecord {
  id: string;
  microgons: number;
  redeemableWithAddresses: string[];
  redeemableAddressSignatures: any;
  claimAddress?: string;
  claimedTime?: Date;
  fundsId?: number;
  fundedTime?: Date;
  createdTime: Date;
  lastUpdatedTime: Date;
}
