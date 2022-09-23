import TimedCache from '@ulixee/commons/lib/TimedCache';
import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';
import RampApp from '../lib/RampApp';

export default class ConsumerPriceIndex {
  public static table = 'consumer_price_index';
  private static cachedLatest = new TimedCache<IConsumerPriceIndex>(10 * 60);
  private static cachedBaseline: IConsumerPriceIndex;

  public data: IConsumerPriceIndex;

  constructor(readonly client: PgClient<DbType.Ramp>, data?: IConsumerPriceIndex) {
    this.data = data;
  }

  public static async record(
    client: PgClient<DbType.Ramp>,
    date: Date,
    value: number,
  ): Promise<IConsumerPriceIndex> {
    const baseline = await this.getBaseline();
    const startValue = baseline?.value ?? value;
    const conversionRate = Math.round((1000 * startValue) / value) / 1000;
    const entry: IConsumerPriceIndex = {
      date,
      value,
      conversionRate,
    };
    this.cachedBaseline ??= entry;
    if (!this.cachedLatest.value || this.cachedLatest.value.date < entry.date) {
      this.cachedLatest.value = entry;
    }

    await client.insert(this.table, entry, true);
    return entry;
  }

  public static async getBaseline(): Promise<IConsumerPriceIndex> {
    this.cachedBaseline ??= await RampApp.db.transaction(db =>
      db.queryOne<IConsumerPriceIndex>(`select * from ${this.table} order by date asc LIMIT 1`),
    );
    return this.cachedBaseline;
  }

  public static async getLatest(refresh = false): Promise<IConsumerPriceIndex> {
    if (!this.cachedLatest.value || refresh) {
      this.cachedLatest.value = await RampApp.db.transaction(db =>
        db.queryOne<IConsumerPriceIndex>(`select * from ${this.table} order by date desc LIMIT 1`),
      );
    }
    return this.cachedLatest.value;
  }
}

export interface IConsumerPriceIndex {
  date: Date;
  value: number;
  conversionRate: number;
}
