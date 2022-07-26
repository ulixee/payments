import { NoteType } from '@ulixee/specification';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import config from '../config';
import { NotFoundError } from '../lib/errors';
import db from '../lib/defaultDb';
import PgClient from '../lib/PgClient';
import { DbType } from '../lib/PgPool';
import { INoteRecord } from './Note';
import BlockManager from '../lib/BlockManager';

interface ISystemWallet {
  address: string;
  centagons: bigint;
  guaranteeBlockHeight: number;
}

export default class Wallet {
  public readonly address: string;
  public balance = 0n;

  constructor(readonly client: PgClient<DbType.Default>, address: string) {
    this.address = address;
  }

  public async create(): Promise<Wallet> {
    await this.client.insert('wallets', { address: this.address });
    return this;
  }

  public async lock(isRetry = false): Promise<Wallet> {
    const { rows } = await this.client.query(
      'SELECT 1 from wallets WHERE address = $1 LIMIT 1 FOR UPDATE',
      [this.address],
    );
    if (!rows.length) {
      if (isRetry) {
        throw new NotFoundError('The wallet provided could not found', this.address);
      }
      await this.create();
      await this.lock(true);
    }
    return this;
  }

  public async load(): Promise<Wallet> {
    this.balance = await Wallet.getBalance(this.client, this.address);
    return this;
  }

  public static async registerAddress(address, logger?: IBoundLog): Promise<Wallet> {
    return await db.transaction(
      client => {
        const wallet = new Wallet(client, address);
        return wallet.create();
      },
      { logger },
    );
  }

  public static async getBalance(
    client: PgClient<DbType.Default>,
    address: string,
  ): Promise<bigint> {
    const { rows } = await client.preparedQuery<{ balance: bigint }>({
      text: `select
  (SELECT COALESCE(SUM(centagons),0)::bigint FROM notes WHERE to_address = $1 and (effective_block_height is null or effective_block_height <= $2)) -
  (SELECT COALESCE(SUM(centagons),0)::bigint FROM notes WHERE from_address = $1 and (effective_block_height is null or effective_block_height <= $2)) as balance`,
      name: 'balance_query',
      values: [address, await BlockManager.currentBlockHeight()],
    });
    if (rows.length) {
      return rows[0].balance ?? 0n;
    }
    return 0n;
  }

  public static async getNoteHashes(
    client: PgClient<DbType.Default>,
    walletAddress: string,
  ): Promise<Buffer[]> {
    const records = await client.list<Pick<INoteRecord, 'noteHash'>>(
      'select note_hash from notes where to_address = $1 or from_address = $1',
      [walletAddress],
    );
    return records.map(x => x.noteHash);
  }

  public static async getAllBalances(
    client: PgClient<DbType.Default>,
    asOfBlockHeight: number,
    openBatchAddresses: string[],
    stakeAddress: string,
  ): Promise<{
    burnBalance: bigint;
    sidechainFundingIn: bigint;
    wallets: ISystemWallet[];
  }> {
    // don't ignore sending money to burn
    const ignoredDestinations = [stakeAddress].concat(openBatchAddresses || []);

    const plusBalances = await client.list<ISystemWallet>(
      `
    SELECT 
      COALESCE(SUM(centagons),0)::bigint as centagons, 
      to_address as address, 
      MAX(guarantee_block_height) as guarantee_block_height
    FROM notes 
      WHERE (effective_block_height is null or effective_block_height <= $1)
      and type != $2
      GROUP BY to_address`,
      [asOfBlockHeight, NoteType.transferOut],
    );

    const minusBalances = await client.list<ISystemWallet>(
      `
    SELECT 
      COALESCE(SUM(centagons),0)::bigint as centagons, 
      from_address as address
    FROM notes 
      WHERE (effective_block_height is null or effective_block_height <= $1)
      and to_address != ANY ($2) and type != $3
      GROUP BY from_address`,
      [asOfBlockHeight, ignoredDestinations, NoteType.transferIn],
    );

    const sidechainFundingInQuery = await client.queryOne<{ centagons: bigint }>(
      `
    SELECT  
      COALESCE(SUM(centagons),0)::bigint as centagons
    FROM notes 
      WHERE (effective_block_height is null or effective_block_height <= $1)
      and type = $2`,
      [asOfBlockHeight, NoteType.transferIn],
    );
    const sidechainFundingOutQuery = await client.queryOne<{ centagons: bigint }>(
      `
    SELECT  
      COALESCE(SUM(centagons),0)::bigint as centagons
    FROM notes 
      WHERE (effective_block_height is null or effective_block_height <= $1)
      and type = $2`,
      [asOfBlockHeight, NoteType.transferOut],
    );

    const sidechainFundingIn =
      (sidechainFundingInQuery.centagons ?? 0n) - (sidechainFundingOutQuery.centagons ?? 0n);

    const wallets: {
      [address: string]: ISystemWallet;
    } = {};

    const openBatchKeys = new Set<string>();
    for (const key of openBatchAddresses) {
      openBatchKeys.add(key);
    }

    for (const record of plusBalances) {
      const address = record.address;
      // don't track money in open batch wallets, sent to burn and/or stake
      if (openBatchKeys.has(address) || address === stakeAddress) {
        continue;
      }

      wallets[address] = record;
    }

    for (const { address, centagons } of minusBalances) {
      if (!wallets[address]) {
        wallets[address] = { address, guaranteeBlockHeight: asOfBlockHeight, centagons: 0n };
      }

      wallets[address].centagons -= centagons;
      if (wallets[address].centagons === 0n) {
        delete wallets[address];
      }
    }

    const burnBalance = wallets[config.nullAddress] || { centagons: 0n };
    delete wallets[config.nullAddress];

    return {
      burnBalance: burnBalance.centagons,
      sidechainFundingIn,
      wallets: Object.values(wallets),
    };
  }
}
