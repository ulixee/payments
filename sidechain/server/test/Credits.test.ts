import IBlockSettings from '@ulixee/block-utils/interfaces/IBlockSettings';
import BlockManager from '../main/lib/BlockManager';
import MicronoteBatchManager from '../main/lib/MicronoteBatchManager';
import MicronoteBatch from '../main/models/MicronoteBatch';
import PgPool, { DbType } from '../utils/PgPool';
import { mockGenesisTransfer, setupDb, stop } from './_setup';
import Client from './_TestClient';
import MicronoteBatchDb from '../batch/db';

let micronoteBatchDb: PgPool<DbType.Batch>;
let micronoteBatch: MicronoteBatch;

beforeAll(async () => {
  await setupDb();
  await mockGenesisTransfer();
  await MicronoteBatchManager.createNewBatches();
  // @ts-ignore
  BlockManager.settingsLoader = {
    isResolved: true,
    promise: Promise.resolve({ height: 5, hash: '1' } as unknown as IBlockSettings),
  };
  micronoteBatch = await MicronoteBatchManager.get();
  // eslint-disable-next-line jest/no-standalone-expect
  expect(micronoteBatch).toBeTruthy();

  micronoteBatchDb = await MicronoteBatchDb.get(micronoteBatch.slug);
  // eslint-disable-next-line jest/no-standalone-expect
  expect(micronoteBatchDb).toBeTruthy();
});

afterAll(async () => {
  await stop();
});

test('should be able to create a Credit', async () => {
  const client = new Client();
  await client.register();
  await client.grantCentagons(51);

  const result = await client.createCredit(50e3);

  expect(result.creditId).toBeTruthy();
  expect(result.sidechainIdentity).toBeTruthy();
});

test('should not be able to create a credit on a micronote batch', async () => {
  const client = new Client();
  await client.register();
  await client.grantCentagons(51);
  const batches = await client.micronoteBatchFunding.getActiveBatches();
  jest.spyOn(client.micronoteBatchFunding, 'getActiveBatches').mockImplementationOnce(async () => {
    return { credit: batches.active, active: batches.credit };
  });

  await expect(client.createCredit(50e3)).rejects.toThrowError('non-credit batch');
});

test('should not be able to settle a credit batch', async () => {
  await expect(
    // @ts-expect-error
    MicronoteBatchManager.settleBatch(MicronoteBatchManager.creditBatch.address, {}),
  ).rejects.toThrowError('Credit batches cannot write to the ledger');
});

test('should not be able to use a note in a credit batch', async () => {
  const client = new Client();
  await client.grantCentagons(51);
  const batches = await client.micronoteBatchFunding.getActiveBatches();
  await expect(client.micronoteBatchFunding.fundBatch(batches.credit, 10)).rejects.toThrowError();
});

test('should allow multiple addresses', async () => {
  const client1 = new Client();
  const client2 = new Client();
  await client1.grantCentagons(51);

  const signedOnceCredit = await client1.createUnsavedCredit(50e3, [
    client1.address,
    client2.address,
  ]);

  await expect(client1.saveCredit(signedOnceCredit)).rejects.toThrowError(
    'A Credit address is missing from the signatures list',
  );

  const signedTwiceCredit = await client2.signCredit(signedOnceCredit);

  await expect(client1.saveCredit(signedTwiceCredit)).resolves.toMatchObject({
    creditId: expect.any(String),
    batchSlug: expect.any(String),
    sidechainIdentity: expect.any(String),
    sidechainValidationSignature: expect.any(Buffer),
  });
});

test('should require multiple addresses to be signed in order', async () => {
  const client1 = new Client();
  const client2 = new Client();
  await client1.grantCentagons(51);

  const signedOnceCredit = await client1.createUnsavedCredit(50e3, [
    client1.address,
    client2.address,
  ]);
  const signedTwiceCredit = await client2.signCredit(signedOnceCredit);
  signedTwiceCredit.allowedRecipientSignatures.reverse();

  await expect(client1.saveCredit(signedTwiceCredit)).rejects.toThrowError('not correctly signed');
});

test('should be able to claim a credit once', async () => {
  const client = new Client();
  await client.grantCentagons(10);
  const credit = await client.createCredit(500);

  const devClient = new Client();

  const result = await Promise.allSettled([
    devClient.claimCredit(credit.creditId, credit.batchSlug),
    devClient.claimCredit(credit.creditId, credit.batchSlug),
  ]);
  expect(result.filter(x => x.status === 'rejected')).toHaveLength(1);
  expect(result.filter(x => x.status === 'fulfilled')).toHaveLength(1);
});

test('should use credits only that apply to the destination addresses', async () => {
  const databoxAuthor1 = new Client();
  await databoxAuthor1.grantCentagons(10);
  const databoxAuthor1Credit = await databoxAuthor1.createCredit(500);

  const databoxAuthor2 = new Client();
  await databoxAuthor2.grantCentagons(10);
  const databoxAuthor2Credit = await databoxAuthor2.createCredit(500);

  const dev = new Client();
  const fund1 = await dev.claimCredit(
    databoxAuthor1Credit.creditId,
    databoxAuthor1Credit.batchSlug,
  );
  const fund2 = await dev.claimCredit(
    databoxAuthor2Credit.creditId,
    databoxAuthor2Credit.batchSlug,
  );

  const micronote1 = await dev.createMicronote(5, [databoxAuthor1.address]);
  expect(micronote1.fundsId).toBe(fund1.fundsId);

  const micronote2 = await dev.createMicronote(5, [databoxAuthor2.address]);
  expect(micronote2.fundsId).toBe(fund2.fundsId);
});

test('should switch to paid batches once depleted', async () => {
  const dboxAuthor = new Client();
  await dboxAuthor.grantCentagons(10);
  const credit = await dboxAuthor.createCredit(500);

  const dev = new Client();
  await dev.grantCentagons(10);
  const fund = await dev.claimCredit(credit.creditId, credit.batchSlug);
  expect(fund.microgonsRemaining).toBe(500);

  const micronote1 = await dev.createMicronote(500, [dboxAuthor.address]);
  expect(micronote1.fundsId).toBe(fund.fundsId);
  expect(micronote1.fundMicrogonsRemaining).toBe(0);

  const micronote2 = await dev.createMicronote(5, [dboxAuthor.address]);
  expect(micronote2.isCreditBatch).toBe(false)
  expect(micronote2.batchSlug).not.toContainEqual(fund.batchSlug);
});
