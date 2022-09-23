import { NoteType } from '@ulixee/specification';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import { NotFoundError } from '@ulixee/payment-utils/lib/errors';
import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';
import MainDb from '../db';
import config from '../../config';
import { INoteRecord } from './Note';
import BlockManager from '../lib/BlockManager';

interface IAddressBalance {
  address: string;
  centagons: bigint;
  guaranteeBlockHeight: number;
}

export default class RegisteredAddress {
  public readonly address: string;
  public balance = 0n;

  constructor(readonly client: PgClient<DbType.Main>, address: string) {
    this.address = address;
  }

  public async create(): Promise<RegisteredAddress> {
    await this.client.insert('addresses', { address: this.address });
    return this;
  }

  public async lock(isRetry = false): Promise<RegisteredAddress> {
    const { rows } = await this.client.query(
      'SELECT 1 from addresses WHERE address = $1 LIMIT 1 FOR UPDATE',
      [this.address],
    );
    if (!rows.length) {
      if (isRetry) {
        throw new NotFoundError('The address provided could not found', this.address);
      }
      await this.create();
      await this.lock(true);
    }
    return this;
  }

  public async load(): Promise<RegisteredAddress> {
    this.balance = await RegisteredAddress.getBalance(this.client, this.address);
    return this;
  }

  public static async register(address: string, logger?: IBoundLog): Promise<RegisteredAddress> {
    return await MainDb.transaction(
      client => {
        const registeredAddress = new RegisteredAddress(client, address);
        return registeredAddress.create();
      },
      { logger },
    );
  }

  public static async getBalance(client: PgClient<DbType.Main>, address: string): Promise<bigint> {
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
    client: PgClient<DbType.Main>,
    address: string,
  ): Promise<Buffer[]> {
    const records = await client.list<Pick<INoteRecord, 'noteHash'>>(
      'select note_hash from notes where to_address = $1 or from_address = $1',
      [address],
    );
    return records.map(x => x.noteHash);
  }

  public static async getAllBalances(
    client: PgClient<DbType.Main>,
    asOfBlockHeight: number,
    openBatchAddresses: string[],
    stakeAddress: string,
  ): Promise<{
    burnBalance: bigint;
    sidechainFundingIn: bigint;
    addressBalances: IAddressBalance[];
  }> {
    // don't ignore sending money to burn
    const ignoredDestinations = [stakeAddress].concat(openBatchAddresses || []);

    const plusBalances = await client.list<IAddressBalance>(
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

    const minusBalances = await client.list<IAddressBalance>(
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

    const balancesByAddress: {
      [address: string]: IAddressBalance;
    } = {};

    const openBatchKeys = new Set<string>();
    for (const key of openBatchAddresses) {
      openBatchKeys.add(key);
    }

    for (const record of plusBalances) {
      const address = record.address;
      // don't track money in open batch addresses, sent to burn and/or stake
      if (openBatchKeys.has(address) || address === stakeAddress) {
        continue;
      }

      balancesByAddress[address] = record;
    }

    for (const { address, centagons } of minusBalances) {
      if (!balancesByAddress[address]) {
        balancesByAddress[address] = { address, guaranteeBlockHeight: asOfBlockHeight, centagons: 0n };
      }

      balancesByAddress[address].centagons -= centagons;
      if (balancesByAddress[address].centagons === 0n) {
        delete balancesByAddress[address];
      }
    }

    const burnBalance = balancesByAddress[config.nullAddress] || { centagons: 0n };
    delete balancesByAddress[config.nullAddress];

    return {
      burnBalance: burnBalance.centagons,
      sidechainFundingIn,
      addressBalances: Object.values(balancesByAddress),
    };
  }
}
