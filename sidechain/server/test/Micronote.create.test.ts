import { sha256 } from '@ulixee/commons/lib/hashUtils';
import { IBlockSettings } from '@ulixee/specification';
import { encodeBuffer } from '@ulixee/commons/lib/bufferUtils';
import ArgonUtils from '@ulixee/sidechain/lib/ArgonUtils';
import PgPool, { DbType } from '@ulixee/payment-utils/pg/PgPool';
import BlockManager from '../main/lib/BlockManager';
import MicronoteBatchManager from '../main/lib/MicronoteBatchManager';
import MicronoteBatch from '../main/models/MicronoteBatch';
import { mockGenesisTransfer, start, stop } from './_setup';
import Client from './_TestClient';
import MicronoteBatchDb from '../batch/db';
import config from '../config';

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

test('should require a valid address for a request', async () => {
  const client = new Client();
  try {
    const res = await client.runRemote('Micronote.create', {
      batchSlug: micronoteBatch.slug,
      address: config.nullAddress,
      microgons: 1010000,
      signature: {
        signers: [
          {
            identity: encodeBuffer(sha256('1234'), 'id'),
            ownershipMerkleProofs: [],
            signature: Buffer.from(
              '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
              'hex',
            ),
          },
        ],
        signatureSettings: {
          countRequired: 1,
          settingsMerkleProofs: [],
        },
      },
      fundsId: '111111111111111111111111111111',
    });
    expect(res).not.toBeTruthy();
  } catch (err) {
    console.log(err);
    expect(err.code).toBe('ERR_PERMISSIONS');
  }
});

test('should be able to create a micronote', async () => {
  // have a partial micronoteBatch remaining and a ledger amount that add to less than required
  const client = new Client();
  // true register client just to simulate process
  await client.register();
  await client.grantCentagons(1500000);

  const { fundsId, id } = await client.createMicronote(200000);

  expect(fundsId).toBeTruthy();
  expect(id).toBeTruthy();
});

test('should retry if multiple micronotes try to create a lock at once', async () => {
  // have a partial micronoteBatch remaining and a ledger amount that add to less than required
  const client = new Client();
  // true register client just to simulate process
  await client.register();
  await client.grantCentagons(1500000);
  client.micronoteBatchFunding.queryFundingToPreload = 10;

  const promises = [];
  for (let i = 0; i < 50; i += 1) {
    const promise = client.createMicronote(ArgonUtils.parseUnits('10c', 'microgons'));
    promises.push(promise);
  }

  const notes = await Promise.all(promises);
  const funds = new Set();
  for (const { fundsId, id } of notes) {
    expect(fundsId).toBeTruthy();
    funds.add(fundsId);
    expect(id).toBeTruthy();
  }
  expect(funds.size).toBe(5);
}, 25e3);

afterAll(async () => {
  await stop();
});
