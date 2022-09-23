import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType, ITransactionOptions } from '@ulixee/payment-utils/pg/PgPool';
import { IBlockchain } from '../lib/USDCNetworks';
import RampApp from '../lib/RampApp';
import EthereumHDWallet from '../lib/EthereumHDWallet';
import RampLock from './RampLock';

export default class USDCAddress {
  public static table = 'usdc_addresses';
  public data: IUSDCAddress;

  constructor(readonly client: PgClient<DbType.Ramp>, data?: IUSDCAddress) {
    this.data = data;
  }

  public static async findOpenAddresses(options: ITransactionOptions): Promise<IUSDCAddress[]> {
    return await RampApp.db.transaction(client => {
      return client.list<IUSDCAddress>(
        `select * from ${this.table} where monitoring_expiration_time > NOW()`,
      );
    }, options);
  }

  public static loadById(client: PgClient<DbType.Ramp>, id: number): Promise<IUSDCAddress> {
    return client.queryOne<IUSDCAddress>(`select * from ${this.table} where id=$1 LIMIT 1`, [id]);
  }

  public static loadByIds(client: PgClient<DbType.Ramp>, ids: number[]): Promise<IUSDCAddress[]> {
    return client.list<IUSDCAddress>(`select * from ${this.table} where id = ANY($1) LIMIT 1`, [
      ids,
    ]);
  }

  public static async allocate(
    client: PgClient<DbType.Ramp>,
    sidechainAddress: string,
    currentBlockNumber: number,
    monitoringExpirationTime: Date,
    rootWallet: EthereumHDWallet<any>,
  ): Promise<EthereumHDWallet<any>> {
    await RampLock.lock(client, rootWallet.meta.rootWalletGuid);
    // find maxIndex
    const maxIndexQuery = await client.queryOne<{ maxIndex: number }>(
      `select max(hd_wallet_index) as max_index from ${this.table} where hd_wallet_guid = $1`,
      [rootWallet.meta.rootWalletGuid],
    );

    const index =  (maxIndexQuery?.maxIndex ?? 0) + 1;
    const childWallet = rootWallet.deriveChild(index);

    await client.insertWithId<IUSDCAddress>(this.table, {
      blockchain: rootWallet.meta.blockchain,
      blockchainNetwork: rootWallet.meta.blockchainNetwork,
      hdWalletGuid: rootWallet.meta.rootWalletGuid,
      hdWalletIndex: index,
      usdcAddress: childWallet.address,
      sidechainAddress,
      allocatedAtBlockNumber: currentBlockNumber,
      monitoringExpirationTime,
    });

    return childWallet;
  }

  public static async getReservesAddresses(
    client: PgClient<DbType.Ramp>,
    walletGuids: string[],
  ): Promise<IUSDCAddress[]> {
    return await client.list(`select * from ${this.table} where hd_wallet_guid = ANY($1)`, [
      walletGuids,
    ]);
  }
}

export interface IUSDCAddress {
  id: number;
  blockchain: IBlockchain;
  blockchainNetwork: string;
  hdWalletGuid: string; // generated ID to track which wallet created (and can manage) this address
  hdWalletIndex: number;
  usdcAddress: string;
  sidechainAddress: string;
  allocatedAtBlockNumber: number;
  lastCheckedBlockNumber?: number;
  monitoringExpirationTime: Date;
}
