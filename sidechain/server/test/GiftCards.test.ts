import { IBlockSettings } from '@ulixee/specification';
import PgPool, { DbType } from '@ulixee/payment-utils/pg/PgPool';
import GiftCards from '@ulixee/sidechain/lib/GiftCards';
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
  jest.spyOn(GiftCards.prototype, 'saveToDisk').mockImplementation(() => null);
  jest.spyOn(GiftCards.prototype, 'getStored').mockImplementation(() => null);
});

afterAll(async () => {
  await stop();
});

test('should be able to create a gift card', async () => {
  const client = new Client();
  await client.register();
  await client.grantCentagons(51);

  const result = await client.giftCards.create(50e3);

  expect(result.giftCardId).toBeTruthy();
});

test('should not be able to create a giftCard on a micronote batch', async () => {
  const client = new Client();
  await client.register();
  await client.grantCentagons(51);
  const batches = await client.micronoteBatchFunding.getActiveBatches();
  jest.spyOn(client.micronoteBatchFunding, 'getActiveBatches').mockImplementationOnce(async () => {
    return { giftCard: batches.micronote[0], micronote: [batches.giftCard] };
  });

  await expect(client.giftCards.create(50e3)).rejects.toThrowError(
    'trying to create a gift card on a Micronote batch',
  );
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

test('should allow multiple issuers', async () => {
  const client1 = new Client();
  const client2 = new Client();
  await client1.grantCentagons(51);

  const signedOnceGiftCard = await client1.giftCards.createUnsaved(50e3, [
    client1.identity,
    client2.identity,
  ]);

  await expect(client1.giftCards.save(signedOnceGiftCard)).rejects.toThrowError(
    'identity is missing from the signatures list',
  );

  const signedTwiceGiftCard = await client2.giftCards.signWithIssuers(
    signedOnceGiftCard,
    client2.credentials.identity,
  );

  await expect(client1.giftCards.save(signedTwiceGiftCard)).resolves.toMatchObject({
    giftCardId: expect.any(String),
    batchSlug: expect.any(String),
  });
});

test('should require multiple issuer identities to be signed in order', async () => {
  const client1 = new Client();
  const client2 = new Client();
  await client1.grantCentagons(51);

  const signedOnceGiftCard = await client1.giftCards.createUnsaved(50e3, [
    client1.identity,
    client2.identity,
  ]);
  const signedTwiceGiftCard = await client2.giftCards.signWithIssuers(
    signedOnceGiftCard,
    client2.credentials.identity,
  );
  signedTwiceGiftCard.issuerSignatures.reverse();

  await expect(client1.giftCards.save(signedTwiceGiftCard)).rejects.toThrowError(
    'not correctly signed',
  );
});

test('should use giftCards only that apply to the destination issuer identities', async () => {
  const databoxAuthor1 = new Client();
  await databoxAuthor1.grantCentagons(10);
  const databoxAuthor1GiftCard = await databoxAuthor1.giftCards.create(500);

  const databoxAuthor2 = new Client();
  await databoxAuthor2.grantCentagons(10);
  const databoxAuthor2GiftCard = await databoxAuthor2.giftCards.create(500);

  const dev = new Client();
  const giftCard1 = await dev.giftCards.store(databoxAuthor1GiftCard.giftCardId, 'gft1');
  const giftCard2 = await dev.giftCards.store(databoxAuthor2GiftCard.giftCardId, 'gft2');

  const foundCard1 = await dev.giftCards.find(5, [databoxAuthor1.identity]);
  expect(foundCard1.giftCardId).toBe(giftCard1.giftCardId);

  const foundCard2 = await dev.giftCards.find(5, [databoxAuthor2.identity]);
  expect(foundCard2.giftCardId).toBe(giftCard2.giftCardId);
});

test('should switch to paid batches once depleted', async () => {
  const dboxAuthor = new Client();
  await dboxAuthor.grantCentagons(10);
  const giftCard = await dboxAuthor.giftCards.create(500);

  const dev = new Client();
  await dev.grantCentagons(101);
  const claimed = await dev.giftCards.store(giftCard.giftCardId, giftCard.redemptionKey);
  expect(claimed.microgonsRemaining).toBe(500);

  const micronote1 = await dev.createMicroPayment({
    microgons: 400,
    giftCardIssuerIdentities: [dboxAuthor.identity],
  });
  expect(micronote1.giftCard?.id).toBe(giftCard.giftCardId);
  await micronote1.onFinalized({ microgons: 495, bytes: 5 });

  const micronote2 = await dev.createMicroPayment({
    microgons: 400,
    giftCardIssuerIdentities: [dboxAuthor.identity],
  });
  expect(micronote2.giftCard).toBeUndefined();
  expect(micronote2.micronote).toBeTruthy();
});

test('should hold and settle funds', async () => {
  const dboxAuthor = new Client();
  await dboxAuthor.grantCentagons(10);
  const giftCard = await dboxAuthor.giftCards.create(500);

  const startBalance = await dboxAuthor.giftCards.get(giftCard.giftCardId);
  expect(startBalance.balance).toBe(500);
  const hold = await dboxAuthor.giftCards.createHold(
    giftCard.giftCardId,
    giftCard.redemptionKey,
    100,
  );

  const holdBalance = await dboxAuthor.giftCards.get(giftCard.giftCardId);
  expect(holdBalance.balance).toBe(400);
  await dboxAuthor.giftCards.settleHold(giftCard.giftCardId, hold.holdId, 99);

  const settleBalance = await dboxAuthor.giftCards.get(giftCard.giftCardId);
  expect(settleBalance.balance).toBe(401);
});

test('should throw NSF if not enough funds for a gift card', async () => {
  const dboxAuthor = new Client();
  const giftCard = await dboxAuthor.giftCards.create(50);

  const startBalance = await dboxAuthor.giftCards.get(giftCard.giftCardId);
  expect(startBalance.balance).toBe(50);
  await expect(
    dboxAuthor.giftCards.createHold(giftCard.giftCardId, giftCard.redemptionKey, 50),
  ).resolves.toBeTruthy();
  await expect(
    dboxAuthor.giftCards.createHold(giftCard.giftCardId, giftCard.redemptionKey, 50),
  ).rejects.toThrowError(expect.objectContaining({ code: 'ERR_NSF' }));
});
