import migrate from '@ulixee/payment-utils/pg/migrate';
import config from '../config';

(async () => {
  await migrate(config.db, `${__dirname}/../migrations`);
})().catch(console.error);
