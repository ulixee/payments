import { RequestOptions } from 'http';
import * as https from 'https';
import Logger from '@ulixee/commons/lib/Logger';
import moment = require('moment');
import ConsumerPriceIndex, { IConsumerPriceIndex } from '../models/ConsumerPriceIndex';
import RampApp from './RampApp';

const { log } = Logger(module);
const hourMillis = 60e3 * 60;
const dayMillis = 24 * hourMillis;

export default class ConsumerPriceIndexMonitor {
  private static interval: NodeJS.Timer;
  private static lockId = 'cpi-monitor';
  private static logger = log.createChild(module);

  private static isStarted: Promise<void>;

  public static async start(): Promise<void> {
    if (!this.isStarted) {
      await RampApp.db.transaction(db => db.insert('locks', { id: this.lockId }, true));
      this.isStarted = this.loadOnStart();
      this.interval = setInterval(() => this.updateTimeseries(), dayMillis).unref();
    }
    return this.isStarted;
  }

  public static stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    return Promise.resolve();
  }

  public static async updateTimeseries(): Promise<IConsumerPriceIndex> {
    const opts = { logger: this.logger };
    return await RampApp.db.transaction(async client => {
      await client.query('select 1 from locks where id=$1 FOR UPDATE LIMIT 1', [this.lockId]);

      const latest = await ConsumerPriceIndex.getLatest(true);
      // see if another node updated.
      if (latest && Date.now() - latest.date.getTime() < dayMillis) return;

      // CPI for All Urban Consumers (CPI-U) 1982-84=100 (Unadjusted)
      const body = await this.httpGet(
        'https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SA0?latest=true',
        {
          headers: {
            accept: 'application/json',
          },
        },
      );

      const json = JSON.parse(body);
      if (json.status === 'REQUEST_NOT_PROCESSED') {
        log.warn('CPI not retrieved', { response: json } as any);
        return null;
      }
      const [{ year, period, value }] = json.Results.series[0].data;
      const entry = parseFloat(value);
      return await ConsumerPriceIndex.record(
        client,
        moment(`${period.slice(1)} ${year}`, 'MM YYYY').toDate(),
        entry,
      );
    }, opts);
  }

  private static async loadOnStart(): Promise<void> {
    const latest = await ConsumerPriceIndex.getLatest(true);
    if (!latest || Date.now() - latest.date.getTime() > dayMillis) {
      await this.updateTimeseries();
    }
  }

  private static httpGet(requestUrl: string, requestOptions: RequestOptions): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      requestOptions.method ??= 'GET';
      const request = https.request(requestUrl, requestOptions, async res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(this.httpGet(res.headers.location, requestOptions));
          return;
        }

        res.on('error', reject);
        res.setEncoding('utf8');
        let result = '';
        for await (const chunk of res) {
          result += chunk;
        }
        resolve(result);
      });
      request.on('error', reject);
      request.end();
    });
  }
}
