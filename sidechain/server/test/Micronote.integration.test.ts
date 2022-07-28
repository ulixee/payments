import IBlockSettings from '@ulixee/block-utils/interfaces/IBlockSettings';
import config from '../config';
import BlockManager from '../main/lib/BlockManager';
import MicronoteBatchManager from '../main/lib/MicronoteBatchManager';
import Micronote from '../batch/models/Micronote';
import MicronoteBatch from '../main/models/MicronoteBatch';
import PgPool, { DbType } from '../utils/PgPool';
import { mockGenesisTransfer, setupDb, stop } from './_setup';
import Client from './_TestClient';
import MicronoteBatchDb from '../batch/db';
import { IMicronoteFundsRecord } from '../batch/models/MicronoteFunds';

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

test('should handle an end to end note', async () => {
  // have a partial micronoteBatch remaining and a ledger amount that add to less than required
  const client = new Client();
  // true register client just to simulate process
  await client.register();
  await client.grantCentagons(1500000);

  const coordinator = new Client();

  const miningBit1 = new Client();

  const miningBit2 = new Client();

  const miningBit3 = new Client();

  const decoderScript = new Client();

  const { fundsId, id } = await client.createMicronote(200e3);

  expect(fundsId).toBeTruthy();
  expect(id).toBeTruthy();
  {
    const submicronoteBatchDb = await MicronoteBatchDb.get(micronoteBatch.slug);
    await submicronoteBatchDb.transaction(async dbclient => {
      const funding = await dbclient.queryOne<IMicronoteFundsRecord>(
        'select * from micronote_funds where id=$1',
        [fundsId],
      );
      expect(funding.microgons).toBe(200e3 * client.batchFundingQueriesToPreload);
      expect(funding.microgonsAllocated).toBe(200e3);
    });
  }

  {
    await coordinator.runSignedAsNode('Micronote.lock', {
      id,
      batchSlug: micronoteBatch.slug,
      identity: coordinator.identity,
    });
    // should not allow a router to exceed the available microgons allocated for the note during
    // completion
    try {
      const res = await coordinator.runSignedAsNode('Micronote.claim', {
        id,
        batchSlug: micronoteBatch.slug,
        identity: coordinator.identity,
        tokenAllocation: {
          [coordinator.address]: 200000,
          [miningBit1.address]: 10000,
          [miningBit2.address]: 10000,
        },
      });
      expect(res).not.toBeTruthy();
    } catch (err) {
      expect(err.data.parameter).toBe('tokenAllocation');
    }

    // should allow a coordinating bit to claim the note
    const noteClaimeRes = await coordinator.runSignedAsNode('Micronote.claim', {
      id,
      batchSlug: micronoteBatch.slug,
      identity: coordinator.identity,
      tokenAllocation: {
        [coordinator.address]: 10000,
        [miningBit1.address]: 20000,
        [miningBit2.address]: 30000,
      },
    });
    expect(noteClaimeRes.finalCost).toBe(
      10e3 + 20e3 + 30e3 + config.micronoteBatch.settlementFeeMicrogons,
    );
  }

  {
    const submicronoteBatchDb = await MicronoteBatchDb.get(micronoteBatch.slug);
    await submicronoteBatchDb.transaction(async dbclient => {
      const funding = await dbclient.queryOne<IMicronoteFundsRecord>(
        'select * from micronote_funds where id=$1',
        [fundsId],
      );

      const note = new Micronote(dbclient, coordinator.address, id);
      const noteDetails = await note.load(true);

      expect(noteDetails.claimedTime).toBeTruthy();
      expect(noteDetails.claimedTime).toBeInstanceOf(Date);
      expect(noteDetails.microgonsAllocated).toBe(200000);

      // spot check data
      const noteRecipients = noteDetails.recipients;
      const coordinatorPart = noteRecipients.find(x => x.address === coordinator.address);
      expect(coordinatorPart.microgonsEarned).toBe(10000);

      const miningBit1Part = noteRecipients.find(x => x.address === miningBit1.address);
      expect(miningBit1Part.microgonsEarned).toBe(20000);
      expect(miningBit1Part.microgonsEarned).toBeTruthy();

      const miningBit2Part = noteRecipients.find(x => x.address === miningBit2.address);
      expect(miningBit2Part.microgonsEarned).toBe(30000);
      expect(miningBit2Part.microgonsEarned).toBeTruthy();

      const miningBit3Part = noteRecipients.find(x => x.address === miningBit3.address);
      expect(miningBit3Part).not.toBeTruthy();

      expect(funding.microgons).toBe(200e3 * client.batchFundingQueriesToPreload);
      const microgonsUsed = 60e3 + config.micronoteBatch.settlementFeeMicrogons;
      expect(funding.microgonsAllocated).toBe(microgonsUsed);
    });
  }
}, 30000);

afterAll(async () => {
  await stop();
});
