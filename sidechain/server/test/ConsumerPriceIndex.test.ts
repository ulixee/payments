import moment = require('moment');
import ConsumerPriceIndexMonitor from '../main/lib/ConsumerPriceIndexMonitor';
import { setupDb, stop } from './_setup';
import config from '../config';
import ConsumerPriceIndex from '../main/models/ConsumerPriceIndex';

beforeAll(async () => {
  config.cpiBaseline.date = '2022-06-01';
  config.cpiBaseline.value = 100;
  await setupDb();
});

afterAll(async () => {
  await stop();
});

test('can poll for updated CPI prices', async () => {
  jest.spyOn<any, any>(ConsumerPriceIndexMonitor, 'httpGet').mockImplementationOnce(async () => {
    return JSON.stringify({
      Results: { series: [{ data: [{ year: 2022, period: 'M07', value: 110 }] }] },
    });
  });
  const series = await ConsumerPriceIndexMonitor.updateTimeseries();
  expect(series.date).toEqual(moment('2022-07-01', 'YYYY-MM-DD').toDate());
  expect(series.value).toBeGreaterThanOrEqual(100);
  expect(series.conversionRate).toBe(0.909); // 100 / 110

  const latest = await ConsumerPriceIndex.getLatest();
  expect(latest.value).toBe(series.value);

  const baseline = await ConsumerPriceIndex.getBaseline();
  expect(baseline.value).toBe(100);
});
