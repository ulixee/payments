import * as moment from 'moment';
import Keyring from '@ulixee/crypto/lib/Keyring';
import Keypair from '@ulixee/crypto/lib/Keypair';
import { mockGenesisTransfer, setupDb, stop } from './_setup';
import MicronoteBatchManager from '../lib/MicronoteBatchManager';
import MicronoteBatch from '../models/MicronoteBatch';
import MicronoteBatchDb from '../lib/MicronoteBatchDb';
import defaultDb from '../lib/defaultDb';

beforeAll(async () => {
  await setupDb();
  await mockGenesisTransfer();
});

test('should create a micronoteBatch db if none exists', async () => {
  await MicronoteBatchManager.createNewBatches();

  const batch = await MicronoteBatchManager.get();
  expect(batch).toBeTruthy();

  // @ts-ignore
  expect(MicronoteBatchManager.openBatches.get(batch.slug)).toBeTruthy();

  const pool = await MicronoteBatchDb.get(batch.slug);
  await pool.shutdown();
  await defaultDb.query(`DROP DATABASE ${MicronoteBatchDb.getName(batch.slug)}`);
});

test('should return the micronoteBatch with the most time left', async () => {
  // @ts-ignore
  MicronoteBatchManager.openBatches.clear();
  // @ts-ignore
  MicronoteBatchManager.batchesPendingSettlement.clear();
  const keypair = Keypair.createSync();
  await defaultDb.transaction(async client => {
    // @ts-ignore
    MicronoteBatchManager.updateCached(
      new MicronoteBatch(
        client,
        {
          address: 'arg1010',
          slug: '1010',
          privateKey: 'private key',
          openTime: moment().add(-5, 'hours').toDate(),
          plannedClosingTime: moment().add(4, 'hours').toDate(),
          stopNewNotesTime: moment().add(3, 'hours').toDate(),
        },
        Keyring.createFromKeypairs([keypair]),
      ),
    );
  });
  // @ts-ignore
  let newBatchesNeeded = MicronoteBatchManager.countNewBatchesNeeded();
  expect(newBatchesNeeded).toBe(0);

  let retrieved = await MicronoteBatchManager.get();
  expect(retrieved.slug).toBe('1010');

  // @ts-ignore
  MicronoteBatchManager.openBatches.clear();

  try {
    retrieved = await MicronoteBatchManager.get();
    expect(retrieved).not.toBeTruthy();
  } catch (err) {
    expect(err).toBeTruthy();
  }

  // @ts-ignore
  newBatchesNeeded = MicronoteBatchManager.countNewBatchesNeeded();
  expect(newBatchesNeeded).toBe(1);

  await defaultDb.transaction(async client => {
    // @ts-ignore
    MicronoteBatchManager.updateCached(
      new MicronoteBatch(
        client,
        {
          address: 'arg1011',
          slug: '1011',
          privateKey: 'private key',
          openTime: moment().add(-5, 'hours').toDate(),
          plannedClosingTime: moment().add(4, 'hours').toDate(),
          stopNewNotesTime: moment().add(1, 'hours').toDate(),
        },
        Keyring.createFromKeypairs([keypair]),
      ),
    );
  });
  retrieved = await MicronoteBatchManager.get();
  expect(retrieved.slug).toBe('1011');

  await defaultDb.transaction(async client => {
    // @ts-ignore
    MicronoteBatchManager.updateCached(
      new MicronoteBatch(
        client,
        {
          address: 'arg2020',
          slug: '1011',
          privateKey: 'private key',
          openTime: moment().add(-6, 'hours').toDate(),
          plannedClosingTime: moment().add(4, 'hours').toDate(),
          stopNewNotesTime: moment().add(2, 'hours').toDate(),
        },
        Keyring.createFromKeypairs([keypair]),
      ),
    );
  });
  retrieved = await MicronoteBatchManager.get();
  expect(retrieved.slug).toBe('1011');

  // @ts-ignore
  newBatchesNeeded = MicronoteBatchManager.countNewBatchesNeeded();
  expect(newBatchesNeeded).toBe(1);
});

afterAll(async () => {
  await stop();
});
