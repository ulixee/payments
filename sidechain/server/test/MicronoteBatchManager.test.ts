import * as moment from 'moment';
import Address from '@ulixee/crypto/lib/Address';
import Identity from '@ulixee/crypto/lib/Identity';
import { mockGenesisTransfer, setupDb, stop } from './_setup';
import MicronoteBatchManager from '../main/lib/MicronoteBatchManager';
import MicronoteBatch, { MicronoteBatchType } from '../main/models/MicronoteBatch';
import MicronoteBatchDb from '../batch/db';
import mainDb from '../main/db';

beforeAll(async () => {
  await setupDb();
  await mockGenesisTransfer();
});

test('should create a micronoteBatch db if none exists', async () => {
  await MicronoteBatchManager.createNewBatches();

  const batch = await MicronoteBatchManager.get();
  expect(batch).toBeTruthy();

  // @ts-ignore
  expect(MicronoteBatchManager.batchesBySlug.get(batch.slug)).toBeTruthy();

  const pool = await MicronoteBatchDb.get(batch.slug);
  await pool.shutdown();
  await mainDb.query(`DROP DATABASE ${MicronoteBatchDb.getName(batch.slug)}`);
});

test('should return the micronoteBatch with the most time left', async () => {
  // @ts-ignore
  MicronoteBatchManager.batchesBySlug.clear();
  const identity = Identity.createSync();
  await mainDb.transaction(async client => {
    // @ts-ignore
    MicronoteBatchManager.updateCached(
      new MicronoteBatch(
        client,
        {
          address: 'arg1010',
          slug: '1010',
          privateKey: 'private key',
          type: MicronoteBatchType.Micronote,
          openTime: moment().add(-5, 'hours').toDate(),
          plannedClosingTime: moment().add(4, 'hours').toDate(),
          stopNewNotesTime: moment().add(3, 'hours').toDate(),
        },
        Address.createFromSigningIdentities([identity]),
      ),
    );
  });
  // @ts-ignore
  let newBatchesNeeded = MicronoteBatchManager.countNewBatchesNeeded();
  expect(newBatchesNeeded).toBe(0);

  let retrieved = await MicronoteBatchManager.get();
  expect(retrieved.slug).toBe('1010');

  // @ts-ignore
  MicronoteBatchManager.batchesBySlug.clear();

  try {
    retrieved = await MicronoteBatchManager.get();
    expect(retrieved).not.toBeTruthy();
  } catch (err) {
    expect(err).toBeTruthy();
  }

  // @ts-ignore
  newBatchesNeeded = MicronoteBatchManager.countNewBatchesNeeded();
  expect(newBatchesNeeded).toBe(1);

  await mainDb.transaction(async client => {
    // @ts-ignore
    MicronoteBatchManager.updateCached(
      new MicronoteBatch(
        client,
        {
          address: 'arg1011',
          slug: '1011',
          privateKey: 'private key',
          type: MicronoteBatchType.Micronote,
          openTime: moment().add(-5, 'hours').toDate(),
          plannedClosingTime: moment().add(4, 'hours').toDate(),
          stopNewNotesTime: moment().add(1, 'hours').toDate(),
        },
        Address.createFromSigningIdentities([identity]),
      ),
    );
  });
  retrieved = await MicronoteBatchManager.get();
  expect(retrieved.slug).toBe('1011');

  await mainDb.transaction(async client => {
    // @ts-ignore
    MicronoteBatchManager.updateCached(
      new MicronoteBatch(
        client,
        {
          address: 'arg2020',
          slug: '1011',
          privateKey: 'private key',
          type: MicronoteBatchType.Micronote,
          openTime: moment().add(-6, 'hours').toDate(),
          plannedClosingTime: moment().add(4, 'hours').toDate(),
          stopNewNotesTime: moment().add(2, 'hours').toDate(),
        },
        Address.createFromSigningIdentities([identity]),
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
