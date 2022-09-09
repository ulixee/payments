import migrate from '@ulixee/payment-utils/pg/migrate';
import * as SidechainTestSetup from '@ulixee/sidechain-server/test/_setup';
import config from '../config';
import RampApp from '../lib/RampApp';
import RampLock from '../models/RampLock';

export async function start() {
  try {
    const sidechainPort = await SidechainTestSetup.start();
    config.sidechainHost = `http://localhost:${sidechainPort}`;
    await SidechainTestSetup.queryWithRootDb(`CREATE DATABASE ${config.db.database}`);
    await migrate(config.db, `${__dirname}/../migrations`);
    await RampLock.init(config.neuteredHDWalletsForSales);
  } catch (err) {
    console.log('error ', err);
    throw err;
  }
}

export async function stop() {
  await SidechainTestSetup.stop();
  await RampApp.db.shutdown();
  await SidechainTestSetup.queryWithRootDb(`DROP DATABASE ${config.db.database} WITH (FORCE);`);
}
