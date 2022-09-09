import IArithmeticEncoding from '@ulixee/specification/types/IArithmeticEncoding';
import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';
import MainDb from '../db';

export default class MainchainBlock {
  public data: IMainchainBlockRecord;

  constructor(readonly client: PgClient<DbType.Main>, data?: Partial<IMainchainBlockRecord>) {
    this.data = data as IMainchainBlockRecord;
  }

  public async save(): Promise<MainchainBlock> {
    await this.client.insert('mainchain_blocks', {
      ...this.data,
      nextLinkTarget: JSON.stringify(this.data.nextLinkTarget),
    });
    return this;
  }

  public async lockForCreate(): Promise<MainchainBlock> {
    await this.client.query(
      'SELECT 1 from mainchain_blocks WHERE block_hash = $1 LIMIT 1 FOR UPDATE',
      [this.data.blockHash],
    );
    return this;
  }

  public static async getStableChainRoot(
    stableBlockHeight: number,
  ): Promise<IMainchainBlockRecord> {
    return await MainDb.transaction(async client => {
      // This returns a list on purpose. Finding stableBlockHeight blocks back
      const blocks = await client.list<IMainchainBlockRecord>(
        `select * from mainchain_blocks where is_longest_chain = true order by height desc limit ${stableBlockHeight}`,
      );
      return blocks[0];
    });
  }

  public static async getLatest4Blocks(): Promise<IMainchainBlockRecord[]> {
    return await MainDb.transaction(async client => {
      const rows = await client.list<IMainchainBlockRecord>(
        'select * from mainchain_blocks where is_longest_chain = true order by height desc limit 4',
      );
      if (!rows) return [];
      return rows.sort((a, b) => a.height - b.height);
    });
  }

  public static async getBlock(hash: Buffer): Promise<IMainchainBlockRecord | null> {
    if (!hash) {
      return null;
    }
    return await MainDb.transaction(async client => {
      const rows = await client.list<IMainchainBlockRecord>(
        'select * from mainchain_blocks where block_hash = $1 limit 1',
        [hash],
      );
      if (rows) {
        return rows[0];
      }
      return null;
    });
  }

  public static async getBlockHeight(hash: Buffer): Promise<number> {
    if (!hash) {
      return null;
    }
    const block = await MainchainBlock.getBlock(hash);
    if (block) {
      return block.height;
    }
    return null;
  }

  public static async getMissingHeights(latestHeight: number, prevHash: Buffer): Promise<number[]> {
    return await MainDb.transaction(async client => {
      {
        const { rows } = await client.query(
          'select 1 from mainchain_blocks where block_hash = $1 limit 1',
          [prevHash],
        );
        if (rows && rows.length) {
          return [];
        }
      }
      {
        const missingHeights: number[] = [];
        const { rows } = await client.query<{ max: number }>(
          'select max(height) as max from mainchain_blocks',
        );
        const maxHeight = rows ? rows[0].max : null;
        let lastHeight = maxHeight;
        if (!lastHeight) {
          lastHeight = 0;
        }
        while (lastHeight < latestHeight) {
          if (lastHeight !== maxHeight) {
            missingHeights.push(lastHeight);
          }
          lastHeight += 1;
        }
        return missingHeights;
      }
    });
  }

  public static async getBlockchain(
    client: PgClient<DbType.Main>,
    blockHash: Buffer,
    maxHistory = 25,
  ): Promise<Pick<IMainchainBlockRecord, 'blockHash' | 'isLongestChain' | 'height'>[]> {
    return await client.list<
      Pick<IMainchainBlockRecord, 'blockHash' | 'isLongestChain' | 'height'>
    >(
      `
    WITH RECURSIVE blockchain AS (
      SELECT
        block_hash,
        prev_block_hash,
        height,
        is_longest_chain
      FROM
        mainchain_blocks
      WHERE
        block_hash = $1   
    UNION
      SELECT
        prev.block_hash,
        prev.prev_block_hash,
        prev.height,
        prev.is_longest_chain
      FROM
         mainchain_blocks prev
      INNER JOIN blockchain b ON b.prev_block_hash = prev.block_hash
    ) 
    SELECT block_hash, is_longest_chain, height from blockchain 
    order by height desc
    limit ${maxHistory}; 
  `,
      [blockHash],
    );
  }

  public static async setLongestChain(
    client: PgClient<DbType.Main>,
    prevBlockHash: Buffer,
  ): Promise<void> {
    const blockchain = await MainchainBlock.getBlockchain(client, prevBlockHash, 50);
    if (!blockchain.length) return;

    const lastBlockInChainOnLongestPath = blockchain
      .filter(x => x.isLongestChain === true)
      .reduce((maxHeight, entry) => {
        if (maxHeight > entry.height) {
          return entry.height;
        }
        return maxHeight;
      }, blockchain[0].height);

    await client.query('update mainchain_blocks set is_longest_chain = false where height > $1', [
      lastBlockInChainOnLongestPath || 0,
    ]);

    const newLongChainBlocks = blockchain.filter(x => x.height > lastBlockInChainOnLongestPath);

    if (newLongChainBlocks.length) {
      const params = newLongChainBlocks.map((_, i) => `$${i + 1}`).join(',');
      await client.update(
        `update mainchain_blocks set is_longest_chain = true where block_hash in (${params})`,
        newLongChainBlocks.map(x => x.blockHash),
      );
    }
  }
}

export interface IMainchainBlockRecord {
  blockHash: Buffer;
  height: number;
  nextLinkTarget: IArithmeticEncoding;
  prevBlockHash?: Buffer;
  isLongestChain: boolean;
}
