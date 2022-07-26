import IBlockSettings from '@ulixee/block-utils/interfaces/IBlockSettings';
import BlockManager from '../lib/BlockManager';
import MicronoteBatchManager from '../lib/MicronoteBatchManager';
import { mockGenesisTransfer, setupDb, stop } from './_setup';
import Client from './_TestClient';
import MicronoteBatchDb from '../lib/MicronoteBatchDb';
import defaultDb from '../lib/defaultDb';
import { INoteRecord } from '../models/Note';
import { IMicronoteFundsRecord } from '../models/MicronoteFunds';

beforeAll(async () => {
  await setupDb();
  await mockGenesisTransfer();
  await MicronoteBatchManager.createNewBatches();
  // @ts-ignore
  BlockManager.settingsLoader = {
    isResolved: true,
    promise: Promise.resolve({ height: 5, hash: '1' } as unknown as IBlockSettings),
  };
});

test('should inform the user if the minimum micronoteBatch cannot be created', async () => {
  const client = new Client();
  await client.grantCentagons(100);
  await client.getMicronoteBatch();
  expect(client.batchSlug).toBeTruthy();

  const funds = await client.fundMicronoteBatch(100);
  await client.runSignedByWallet('Micronote.create', {
    batchSlug: client.batchSlug,
    address: client.address,
    microgons: 99 * 10e3,
    fundsId: funds.fundsId,
  });
  try {
    const res = await client.runSignedByWallet('Micronote.create', {
      batchSlug: client.batchSlug,
      address: client.address,
      microgons: 10001,
      fundsId: funds.fundsId,
    });
    expect(res).not.toBeTruthy();
  } catch (err) {
    expect(err.code).toBe('ERR_NEEDS_BATCH_FUNDING');
  }
});

test('should be able to fund a micronote batch', async () => {
  const client = new Client();
  // do the true register process here
  await client.grantCentagons(103);
  await client.getMicronoteBatch();

  const { fundsId } = await client.fundMicronoteBatch(100);
  expect(fundsId).toBeGreaterThan(0);

  const micronoteBatchDb = await MicronoteBatchDb.get(client.batchSlug);
  await defaultDb.transaction(async dbClient => {
    const note = await dbClient.queryOne<INoteRecord>(
      'select * from notes where from_address = $1 and to_address = $2',
      // @ts-ignore
      [client.address, client._micronoteBatch.micronoteBatchAddress],
    );
    expect(note).toBeTruthy();

    const { rows } = await micronoteBatchDb.query('select * from micronote_funds where id = $1', [
      fundsId,
    ]);
    const [batch] = rows;
    expect(batch.address).toEqual(client.address);
    expect(batch.note_hash).toEqual(note.noteHash);
    expect(Number(note.centagons) * 10e3).toBe(batch.microgons);
    expect(Number(batch.microgons_allocated)).toBe(0);
  });
});

test('should not allow a consumer to initiate a note if they do not have enough microgons available', async () => {
  // have a partial micronoteBatch remaining and a ledger amount that add to less than required
  const client = new Client();
  await client.grantCentagons(50);
  const batch = await MicronoteBatchManager.get();
  const micronoteBatchDb = await MicronoteBatchDb.get(batch.slug);
  await micronoteBatchDb.query(
    'insert into micronote_funds (address, note_hash,' +
      ' microgons, microgons_allocated, guarantee_block_height) values ($1,$2,$3,$4,0)',
    [client.address, Buffer.from('hash'), 80, 70],
  );

  try {
    const funds = await client.fundMicronoteBatch(50);
  } catch (err) {
    expect(err.code).toBe('ERR_NEEDS_BATCH_FUNDING');
  }
});

afterAll(async () => {
  await stop();
}, 10e3);
