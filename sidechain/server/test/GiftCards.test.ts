import { IBlockSettings } from '@ulixee/specification';
import PgPool, { DbType } from '@ulixee/payment-utils/pg/PgPool';
import BlockManager from '../main/lib/BlockManager';
import MicronoteBatchManager from '../main/lib/MicronoteBatchManager';
import MicronoteBatch from '../main/models/MicronoteBatch';
import { mockGenesisTransfer, start, stop } from './_setup';
import Client from './_TestClient';
import MicronoteBatchDb from '../batch/db';

let micronoteBatchDb: PgPool<DbType.Batch>;
let micronoteBatch: MicronoteBatch;

beforeAll(async () => {
  await start();
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

test('should be able to create a gift card', async () => {
  const client = new Client();
  await client.register();
  await client.grantCentagons(51);

  const result = await client.createGiftCard(50e3);

  expect(result.giftCardId).toBeTruthy();
  expect(result.sidechainIdentity).toBeTruthy();
});

test('should not be able to create a giftCard on a micronote batch', async () => {
  const client = new Client();
  await client.register();
  await client.grantCentagons(51);
  const batches = await client.micronoteBatchFunding.getActiveBatches();
  jest.spyOn(client.micronoteBatchFunding, 'getActiveBatches').mockImplementationOnce(async () => {
    return { giftCard: batches.micronote[0], micronote: [batches.giftCard] };
  });

  await expect(client.createGiftCard(50e3)).rejects.toThrowError('trying to create a gift card on a Micronote batch');
});

test('should not be able to settle a giftCard batch', async () => {
  await expect(
    // @ts-expect-error
    MicronoteBatchManager.settleBatch(MicronoteBatchManager.giftCardBatch.address, {}),
  ).rejects.toThrowError('Gift card batches cannot write to the ledger');
});

test('should not be able to use a note in a giftCard batch', async () => {
  const client = new Client();
  await client.grantCentagons(51);
  const batches = await client.micronoteBatchFunding.getActiveBatches();
  await expect(client.micronoteBatchFunding.fundBatch(batches.giftCard, 10)).rejects.toThrowError();
});

test('should allow multiple addresses', async () => {
  const client1 = new Client();
  const client2 = new Client();
  await client1.grantCentagons(51);

  const signedOnceGiftCard = await client1.createUnsavedGiftCard(50e3, [
    client1.address,
    client2.address,
  ]);

  await expect(client1.saveGiftCard(signedOnceGiftCard)).rejects.toThrowError(
    'address is missing from the signatures list',
  );

  const signedTwiceGiftCard = await client2.signGiftCard(signedOnceGiftCard);

  await expect(client1.saveGiftCard(signedTwiceGiftCard)).resolves.toMatchObject({
    giftCardId: expect.any(String),
    batchSlug: expect.any(String),
    sidechainIdentity: expect.any(String),
    sidechainValidationSignature: expect.any(Buffer),
  });
});

test('should require multiple addresses to be signed in order', async () => {
  const client1 = new Client();
  const client2 = new Client();
  await client1.grantCentagons(51);

  const signedOnceGiftCard = await client1.createUnsavedGiftCard(50e3, [
    client1.address,
    client2.address,
  ]);
  const signedTwiceGiftCard = await client2.signGiftCard(signedOnceGiftCard);
  signedTwiceGiftCard.redeemableAddressSignatures.reverse();

  await expect(client1.saveGiftCard(signedTwiceGiftCard)).rejects.toThrowError('not correctly signed');
});

test('should be able to claim a giftCard once', async () => {
  const client = new Client();
  await client.grantCentagons(10);
  const giftCard = await client.createGiftCard(500);

  const devClient = new Client();

  const result = await Promise.allSettled([
    devClient.claimGiftCard(giftCard.giftCardId, giftCard.batchSlug),
    devClient.claimGiftCard(giftCard.giftCardId, giftCard.batchSlug),
  ]);
  expect(result.filter(x => x.status === 'rejected')).toHaveLength(1);
  expect(result.filter(x => x.status === 'fulfilled')).toHaveLength(1);
});

test('should use giftCards only that apply to the destination addresses', async () => {
  const databoxAuthor1 = new Client();
  await databoxAuthor1.grantCentagons(10);
  const databoxAuthor1GiftCard = await databoxAuthor1.createGiftCard(500);

  const databoxAuthor2 = new Client();
  await databoxAuthor2.grantCentagons(10);
  const databoxAuthor2GiftCard = await databoxAuthor2.createGiftCard(500);

  const dev = new Client();
  const fund1 = await dev.claimGiftCard(
    databoxAuthor1GiftCard.giftCardId,
    databoxAuthor1GiftCard.batchSlug,
  );
  const fund2 = await dev.claimGiftCard(
    databoxAuthor2GiftCard.giftCardId,
    databoxAuthor2GiftCard.batchSlug,
  );

  const micronote1 = await dev.createMicronote(5, [databoxAuthor1.address]);
  expect(micronote1.fundsId).toBe(fund1.fundsId);

  const micronote2 = await dev.createMicronote(5, [databoxAuthor2.address]);
  expect(micronote2.fundsId).toBe(fund2.fundsId);
});

test('should switch to paid batches once depleted', async () => {
  const dboxAuthor = new Client();
  await dboxAuthor.grantCentagons(10);
  const giftCard = await dboxAuthor.createGiftCard(500);

  const dev = new Client();
  await dev.grantCentagons(101);
  const fund = await dev.claimGiftCard(giftCard.giftCardId, giftCard.batchSlug);
  expect(fund.microgonsRemaining).toBe(500);

  const micronote1 = await dev.createMicronote(500, [dboxAuthor.address]);
  expect(micronote1.fundsId).toBe(fund.fundsId);
  expect(micronote1.fundMicrogonsRemaining).toBe(0);

  const micronote2 = await dev.createMicronote(5, [dboxAuthor.address]);
  expect(micronote2.isGiftCardBatch).toBe(false)
  expect(micronote2.batchSlug).not.toContainEqual(fund.batchSlug);
});
