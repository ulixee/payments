import migrate from '../utils/migrate';
import config from '../config';

(async () => {
  await migrate(config.mainDatabase, `${__dirname}/../main/migrations`);
  await migrate(config.ramp.database, `${__dirname}/../ramps/migrations`);
})().catch(console.error);
