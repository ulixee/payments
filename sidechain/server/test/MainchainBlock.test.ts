import { sha3 } from '@ulixee/commons/lib/hashUtils';
import MainchainBlock, { IMainchainBlockRecord } from '../models/MainchainBlock';
import db from '../lib/defaultDb';
import PgClient from '../lib/PgClient';
import { DbType } from '../lib/PgPool';
import { setupDb, stop } from './_setup';

beforeAll(async () => {
  await setupDb();
});

async function createBlock(
  client: PgClient<DbType.Default>,
  hash: string,
  height: number,
  isLongestChain: boolean,
  prevBlockHash?: string,
) {
  await new MainchainBlock(client, {
    height,
    prevBlockHash: prevBlockHash ? sha3(prevBlockHash) : null,
    blockHash: sha3(hash),
    isLongestChain,
    nextLinkTarget: { powerOf2: 256 },
  }).save();
}

test('should track longest block', async () => {
  await db.transaction(async client => {
    await createBlock(client, 'gen', 0, true);
    await createBlock(client, '1', 1, true, 'gen');
    await createBlock(client, '2', 2, true, '1');
    await createBlock(client, '3', 3, true, '2');

    await createBlock(client, '1a', 1, false, 'gen');
    await createBlock(client, '2a', 2, false, '1a');
    await createBlock(client, '3a', 3, false, '2a');

    await createBlock(client, '2b', 2, false, '1');
    await createBlock(client, '3b', 3, false, '2a');
  });

  {
    const last4 = await MainchainBlock.getLatest4Blocks();
    expect(last4[0].blockHash).toEqual(sha3('gen'));
    expect(last4[1].blockHash).toEqual(sha3('1'));
    expect(last4[2].blockHash).toEqual(sha3('2'));
    expect(last4[3].blockHash).toEqual(sha3('3'));
  }

  await db.transaction(async client => {
    await MainchainBlock.setLongestChain(client, sha3('3a'));
    await createBlock(client, '4a', 4, true, '3a');
  });

  {
    const last4 = await MainchainBlock.getLatest4Blocks();
    expect(last4[0].blockHash).toEqual(sha3('1a'));
    expect(last4[1].blockHash).toEqual(sha3('2a'));
    expect(last4[2].blockHash).toEqual(sha3('3a'));
    expect(last4[3].blockHash).toEqual(sha3('4a'));
  }
  await db.transaction(async client => {
    const longest = await client.list<IMainchainBlockRecord>(
      'select * from mainchain_blocks where is_longest_chain = true',
    );
    expect(longest).toHaveLength(5);
  });
});

test('should find gaps in the chain', async () => {
  await db.transaction(async client => {
    await client.query('truncate mainchain_blocks cascade');
  });
  {
    const missing = await MainchainBlock.getMissingHeights(5, sha3('prev'));
    expect(missing).toEqual([0, 1, 2, 3, 4]);
  }
  await db.transaction(async client => {
    await createBlock(client, 'gen', 0, true);
    await createBlock(client, '1', 1, true, 'gen');
  });
  {
    const missing = await MainchainBlock.getMissingHeights(5, sha3('prev'));
    expect(missing).toEqual([2, 3, 4]);
  }
  {
    const missing = await MainchainBlock.getMissingHeights(5, sha3('gen'));
    expect(missing).toEqual([]);
  }
});

afterAll(async () => {
  await stop();
});
