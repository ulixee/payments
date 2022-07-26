import { sha3 } from '@ulixee/commons/lib/hashUtils';
import IBlockSettings from '@ulixee/block-utils/interfaces/IBlockSettings';
import Keypair from '@ulixee/crypto/lib/Keypair';
import config from '../config';
import BlockManager from '../lib/BlockManager';
import MainchainBlock, { IMainchainBlockRecord } from '../models/MainchainBlock';
import db from '../lib/defaultDb';
import { mockGenesisTransfer, setupDb, stop } from './_setup';
import Client from './_TestClient';

let client: Client;
beforeAll(async () => {
  await setupDb();
  await mockGenesisTransfer();

  // @ts-ignore
  BlockManager.settingsLoader = {
    isResolved: true,
    promise: Promise.resolve({
      height: 15,
      hash: sha3('15'),
      nextLinkTarget: {
        powerOf2: 256,
      },
    } as unknown as IBlockSettings),
  };

  const blocks = [];
  for (let i = 0; i <= 15; i += 1) {
    blocks.push({
      height: i,
      isLongestChain: true,
      prevBlockHash: blocks.length > 0 ? blocks[i - 1].blockHash : null,
      blockHash: sha3(`${i}`),
      nextLinkTarget: {
        powerOf2: 256,
      },
    });
  }
  await db.transaction(dbc => {
    return dbc.batchInsert<IMainchainBlockRecord>('mainchain_blocks', blocks);
  });
  // @ts-ignore
  BlockManager.last4Blocks = MainchainBlock.getLatest4Blocks();
  client = new Client();
}, 10e3);

test('should be able to get the current stake settings', async () => {
  const settings = await client.stakeSettings();
  expect(settings.rootPublicKey).toBeTruthy();
  expect(settings.stakeAddress).toBeTruthy();
  expect(settings.stableBlockHeight).toBe((await BlockManager.getStableBlock()).height);
});

test('should be able to create a stake', async () => {
  const settings = await client.stakeSettings();
  await client.grantCentagons(settings.centagons + 10001n);
  expect(settings.rootPublicKey).toBeTruthy();
  expect(settings.stakeAddress).toBeTruthy();
  expect(settings.stableBlockHeight).toBeGreaterThan(0);

  const stake = await client.createStake(client.publicKey);
  expect(stake.blockHeight).toBe((await BlockManager.getStableBlock()).height);
  expect(stake.signature).toBeTruthy();
  expect(stake.rootPublicKey).toEqual(config.rootKey.publicKey);
  expect(
    Keypair.verify(
      stake.rootPublicKey,
      sha3(Buffer.concat([client.publicKey, Buffer.from(`${stake.blockHeight}`)])),
      stake.signature,
    ),
  ).toBeTruthy();

  const balance = await client.getBalance();
  expect(balance.toString()).toBe('10001');
});

test('should be able to get stake signatures', async () => {
  const signature = await client.getStakeSignature();
  expect(signature.blockHeight).toBe((await BlockManager.getStableBlock()).height);
  expect(signature.signature).toBeTruthy();
  expect(signature.rootPublicKey).toEqual(config.rootKey.publicKey);
  expect(
    Keypair.verify(
      signature.rootPublicKey,
      sha3(Buffer.concat([client.publicKey, Buffer.from(`${signature.blockHeight}`)])),
      signature.signature,
    ),
  ).toBe(true);
});

test('should be able to refund a stake', async () => {
  const balance = await client.getBalance();
  expect(balance.toString()).toBe('10001');

  const res = await client.refundStake(client.publicKey);
  expect(res.refundNoteHash).toBeTruthy();
  expect(res.blockEndHeight).toBe((await BlockManager.getStableBlock()).height);
  expect(res.refundEffectiveHeight).toBeGreaterThan((await BlockManager.getStableBlock()).height);

  const afterBalance = await client.getBalance();
  expect(afterBalance.toString()).toBe('10001');

  const tx = await client.getNote(res.refundNoteHash);
  expect(tx).toBeTruthy();
  expect(tx.centagons).toBe(config.stakeSettings.currentCentagons);

  try {
    // should not be able to refresh the stake signatures anymore
    const signature = await client.getStakeSignature();
    expect(signature).not.toBeTruthy();
  } catch (err) {
    expect(err).toBeTruthy();
  }
});

test('should not be able to stake more funds than are available', async () => {
  try {
    const newStake = await client.createStake(client.publicKey);
    expect(newStake).not.toBeTruthy();
  } catch (err) {
    expect(err).toBeTruthy();
  }
});

afterAll(async () => {
  await stop();
}, 10e3);
