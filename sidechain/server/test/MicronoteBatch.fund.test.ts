import { IBlockSettings } from '@ulixee/specification';
import ArgonUtils from '@ulixee/sidechain/lib/ArgonUtils';
import { nanoid } from 'nanoid';
import BlockManager from '../main/lib/BlockManager';
import MicronoteBatchManager from '../main/lib/MicronoteBatchManager';
import { mockGenesisTransfer, start, stop } from './_setup';
import Client from './_TestClient';
import MicronoteBatchDb from '../batch/db';
import mainDb from '../main/db';
import { INoteRecord } from '../main/models/Note';
import config from '../config';

beforeAll(async () => {
  await start();
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
  const batches = await client.micronoteBatchFunding.getActiveBatches();
  expect(batches.micronote[0].batchSlug).toBeTruthy();

  const funds = await client.micronoteBatchFunding.fundBatch(batches.micronote[0], 100);
  await client.runSignedByAddress('Micronote.create', {
    batchSlug: batches.micronote[0].batchSlug,
    address: client.address,
    microgons: Number(ArgonUtils.parseUnits('99c', 'microgons')),
    fundsId: funds.fundsId,
  });
  try {
    const res = await client.runSignedByAddress('Micronote.create', {
      batchSlug: batches.micronote[0].batchSlug,
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
  const batches = await client.micronoteBatchFunding.getActiveBatches();

  const { fundsId } = await client.micronoteBatchFunding.fundBatch(batches.micronote[0], 100);
  expect(fundsId).toBeTruthy();

  const micronoteBatchDb = await MicronoteBatchDb.get(batches.micronote[0].batchSlug);
  await mainDb.transaction(async dbClient => {
    const note = await dbClient.queryOne<INoteRecord>(
      'select * from notes where from_address = $1 and to_address = $2',
      [client.address, batches.micronote[0].micronoteBatchAddress],
    );
    expect(note).toBeTruthy();

    const { rows } = await micronoteBatchDb.query('select * from micronote_funds where id = $1', [
      fundsId,
    ]);
    const [batch] = rows;
    expect(batch.address).toEqual(client.address);
    expect(batch.note_hash).toEqual(note.noteHash);
    expect(ArgonUtils.centagonsToMicrogons(note.centagons)).toBe(batch.microgons);
    expect(Number(batch.microgons_allocated)).toBe(0);
  });
});

test('should not allow a consumer to initiate a note if they do not have enough microgons available', async () => {
  // have a partial micronoteBatch remaining and a ledger amount that add to less than required
  const client = new Client();
  config.micronoteBatch.minimumFundingCentagons = 50n;
  await client.grantCentagons(50);
  const batches = await client.micronoteBatchFunding.getActiveBatches();
  const batch = await MicronoteBatchManager.get();
  const micronoteBatchDb = await MicronoteBatchDb.get(batch.slug);
  await micronoteBatchDb.query(
    'insert into micronote_funds (id, address, note_hash,' +
      ' microgons, microgons_allocated, guarantee_block_height) values ($1,$2,$3,$4,$5,0)',
    [nanoid(30), client.address, Buffer.from('hash'), 80, 70],
  );

  try {
    await client.micronoteBatchFunding.fundBatch(batches.micronote[0], 50);
  } catch (err) {
    expect(err.code).toBe('ERR_NEEDS_BATCH_FUNDING');
  }
});

afterAll(async () => {
  await stop();
}, 10e3);
