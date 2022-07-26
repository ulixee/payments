import IBlockSettings from '@ulixee/block-utils/interfaces/IBlockSettings';
import BlockManager from '../lib/BlockManager';
import { mockGenesisTransfer, setupDb, stop } from './_setup';
import Client from './_TestClient';

beforeAll(async () => {
  await setupDb();
  await mockGenesisTransfer();
  // @ts-ignore
  BlockManager.settingsLoader = {
    isResolved: true,
    promise: Promise.resolve({ height: 5, hash: '1' } as unknown as IBlockSettings),
  };
}, 10e3);

test('should allow an wallet to retrieve a balance', async () => {
  const client = new Client();
  await client.grantCentagons(2523n);
  const balance = await client.getBalance();
  expect(balance).toBe(2523n);
});

test('should allow you to transfer funds to another wallet', async () => {
  const client1 = new Client();
  await client1.register();
  await client1.grantCentagons(317n);
  await client1.grantCentagons(515n);
  await client1.grantCentagons(110n);

  const client2 = new Client();
  await client2.register();
  await client2.grantCentagons(1n);

  const note = await client1.transferNote(720n, client2.address);
  expect(note.centagons).toBe(720n);
  expect(note.noteHash).toBeTruthy();
  expect(note.timestamp).toBeTruthy();
  expect(new Date().getTime() - note.timestamp.getTime()).toBeLessThanOrEqual(1000);

  {
    const balance = await client1.getBalance();
    expect(balance).toBe(222n);
  }
  {
    const balance = await client2.getBalance();
    expect(balance).toBe(721n);
  }
  const storedNote = await client1.getNote(note.noteHash);
  expect(storedNote.centagons).toBe(720n);
});

test('should allow you to transfer funds to an wallet that does not exist yet', async () => {
  const client1 = new Client();
  await client1.register();
  await client1.grantCentagons(317n);
  await client1.grantCentagons(515n);
  await client1.grantCentagons(110n);

  const client2 = new Client();
  {
    const tx = await client1.transferNote(720n, client2.address);
    expect(tx).toBeTruthy();
    const balance = await client2.getBalance();
    expect(balance).toBe(720n);

    const isRegistered = await client2.isRegistered();
    expect(isRegistered).toBe(false);
  }
  {
    const tx2 = await client2.transferNote(1n, client1.address);
    expect(tx2).toBeTruthy();

    const isRegistered = await client2.isRegistered();
    expect(isRegistered).toBe(true);
  }
});

test('should not allow you to transfer more than your available balance', async () => {
  const client1 = new Client();
  await client1.register();
  await client1.grantCentagons(317n);
  await client1.grantCentagons(515n);
  await client1.grantCentagons(110n);

  const client2 = new Client();
  await client2.register();

  const [tx1, tx2, tx3] = await Promise.all([
    client1.transferNote(612n, client2.address).catch(err => err),
    client1.transferNote(421n, client2.address).catch(err => err),
    client1.transferNote(4234234343434212342n, client2.address).catch(err => err),
  ]);
  let failures = 0;
  if (tx1 instanceof Error) failures += 1;
  if (tx2 instanceof Error) failures += 1;
  if (tx3 instanceof Error) failures += 1;
  expect(failures).toBe(2);

  const balance = await client1.getBalance();
  expect(balance).toBeLessThan(525n);
});

afterAll(async () => {
  await stop();
}, 10e3);
