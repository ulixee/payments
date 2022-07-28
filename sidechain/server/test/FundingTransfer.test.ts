import { sha3 } from '@ulixee/commons/lib/hashUtils';
import IBlockSettings from '@ulixee/block-utils/interfaces/IBlockSettings';
import MainchainClient from '@ulixee/mainchain-client';
import BlockManager from '../main/lib/BlockManager';
import SidechainSecurities from '../main/lib/SidechainSecurities';
import MainchainBlock, { IMainchainBlockRecord } from '../main/models/MainchainBlock';
import MainchainTransaction from '../main/models/MainchainTransaction';
import MainDb from '../main/db';
import { mockGenesisTransfer, setupDb, stop } from './_setup';
import Client from './_TestClient';
import SecurityMainchainBlock from '../main/models/SecurityMainchainBlock';

let client: Client;
beforeAll(async () => {
  await setupDb();
  await mockGenesisTransfer();

  // @ts-ignore
  BlockManager.settingsLoader = {
    isResolved: true,
    promise: Promise.resolve({ height: 5, hash: '1' } as unknown as IBlockSettings),
  };
  // @ts-expect-error
  BlockManager.client = new MainchainClient('http://127.0.0.1:1337');
  // @ts-ignore
  BlockManager.last4Blocks = Promise.resolve([
    {
      height: 5,
      blockHash: '1',
    },
    {
      height: 6,
      blockHash: '1',
    },
    {
      height: 7,
      blockHash: '1',
    },
    {
      height: 8,
      blockHash: '1',
    },
  ] as IMainchainBlockRecord[]);
  client = new Client();
});

test('should allow a user to transfer their funds out', async () => {
  await client.grantCentagons(150);

  const res = await client.returnFundsToMainchain(120);
  expect(res.noteHash).toBeTruthy();
});

test('should be able to get the status of a transfer', async () => {
  await client.grantCentagons(100001);

  const res = await client.returnFundsToMainchain(10);
  expect(res.noteHash).toBeTruthy();

  const status1 = await client.getMainchainTransferStatus(res.noteHash);
  expect(status1.blocks).toHaveLength(0);
  expect(status1.currentBlockHeight).toBeGreaterThan(4);

  await MainDb.transaction(async dbclient => {
    const sidechainSecurities = new SidechainSecurities(dbclient, {
      blockHash: Buffer.from('solved'),
      height: 23,
      isLongestChain: true,
      nextLinkTarget: {
        powerOf2: 256,
      },
    });
    // now simulate writing it to a block
    // @ts-ignore
    const { transfersOut } = await sidechainSecurities.buildFundingTransfersOut();

    const [transaction] = transfersOut;
    // and simulate the block picking up the transaction
    await new MainchainBlock(dbclient, {
      blockHash: sha3('solved'),
      height: 23,
      isLongestChain: true,
      nextLinkTarget: {
        powerOf2: 256,
      },
    }).save();

    await SecurityMainchainBlock.record(dbclient, {
      transactionHash: transaction.transactionHash,
      blockHash: sha3('solved'),
      blockHeight: 23,
      blockStableLedgerIndex: 0,
    });
  });

  const status2 = await client.getMainchainTransferStatus(res.noteHash);
  expect(status2.blocks[0].blockHash).toEqual(sha3('solved'));
  expect(status2.blocks[0].blockHeight).toBe(23);
  expect(status2.transactionHash).toBeTruthy();

  await MainDb.transaction(async dbclient => {
    const tx = await MainchainTransaction.getTransaction(dbclient, status2.transactionHash);
    expect(tx.transactionHash).toEqual(status2.transactionHash);
    expect(tx.outputs.find(x => x.centagons === 10n)).toBeTruthy();
  });
});

afterAll(async () => {
  await stop();
}, 10e3);
