import config from '../config';
import PgPool, { DbType } from '../utils/PgPool';
import RampLock from './models/RampLock';
import EthereumHDWallet from './lib/EthereumHDWallet';

const RampDb = new PgPool<DbType.Ramp>(config.ramp.database, config.db);

export default RampDb;

export async function setup(rootWallets: EthereumHDWallet<any>[]): Promise<void> {
  await RampDb.transaction(async client => {
    for (const wallet of rootWallets) {
      await RampLock.create(client, wallet.meta.rootWalletGuid);
    }
  });
}
