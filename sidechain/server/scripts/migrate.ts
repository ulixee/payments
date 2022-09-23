import migrate from '@ulixee/payment-utils/pg/migrate';
import config from '../config';

(async () => {
  await migrate({ ...config.db, database: config.mainDatabase }, `${__dirname}/../main/migrations`);
})().catch(console.error);
