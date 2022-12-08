import { IBlockSettings } from '@ulixee/specification';
import PgPool, { DbType } from '@ulixee/payment-utils/pg/PgPool';
import config from '../config';
import BlockManager from '../main/lib/BlockManager';
import MicronoteBatchManager from '../main/lib/MicronoteBatchManager';
import Micronote from '../batch/models/Micronote';
import MicronoteBatch from '../main/models/MicronoteBatch';
import { mockGenesisTransfer, start, stop } from './_setup';
import Client from './_TestClient';
import MicronoteBatchDb from '../batch/db';
import { IMicronoteFundsRecord } from '../batch/models/MicronoteFunds';

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

test('should handle an end to end micronote', async () => {
  // have a partial micronoteBatch remaining and a ledger amount that add to less than required
  const client = new Client();
  // true register client just to simulate process
  await client.register();
  await client.grantCentagons(1500000);

  const leadWorker = new Client();

  const worker1 = new Client();
  const worker2 = new Client();
  const worker3 = new Client();

  const { fundsId, id } = await client.createMicronote(200e3);

  expect(fundsId).toBeTruthy();
  expect(id).toBeTruthy();
  {
    const subMicronoteBatchDb = await MicronoteBatchDb.get(micronoteBatch.slug);
    await subMicronoteBatchDb.transaction(async dbclient => {
      const funding = await dbclient.queryOne<IMicronoteFundsRecord>(
        'select * from micronote_funds where id=$1',
        [fundsId],
      );
      expect(funding.microgons).toBe(200e3 * client.micronoteBatchFunding.queryFundingToPreload);
      expect(funding.microgonsAllocated).toBe(200e3);
    });
  }

  {
    const hold = await leadWorker.runSignedByIdentity('Micronote.hold', {
      id,
      batchSlug: micronoteBatch.slug,
      identity: leadWorker.identity,
      microgons: 10000 + 20000 + 30000,
    });
    // should not allow a settlement to exceed the available microgons allocated for the note during
    // completion
    try {
      const res = await leadWorker.runSignedByIdentity('Micronote.settle', {
        id,
        holdId: hold.holdId,
        isFinal: true,
        batchSlug: micronoteBatch.slug,
        identity: leadWorker.identity,
        tokenAllocation: {
          [leadWorker.address]: 200000,
          [worker1.address]: 10000,
          [worker2.address]: 10000,
        },
      });
      expect(res).not.toBeTruthy();
    } catch (err) {
      expect(err.data.parameter).toBe('tokenAllocation');
    }

    // should allow an initiator to claim the micronote
    const noteClaimeRes = await leadWorker.runSignedByIdentity('Micronote.settle', {
      id,
      holdId: hold.holdId,
      isFinal: true,
      batchSlug: micronoteBatch.slug,
      identity: leadWorker.identity,
      tokenAllocation: {
        [leadWorker.address]: 10000,
        [worker1.address]: 20000,
        [worker2.address]: 30000,
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

      const note = new Micronote(dbclient, leadWorker.address, id);
      const noteDetails = await note.load({ includeRecipients: true, includeHolds: true });

      expect(noteDetails.lockedTime).toBeTruthy();
      expect(noteDetails.lockedTime).toBeInstanceOf(Date);
      expect(noteDetails.microgonsAllocated).toBe(200000);

      // spot check data
      const noteRecipients = noteDetails.recipients;
      const leadWorkerPart = noteRecipients.find(x => x.address === leadWorker.address);
      expect(leadWorkerPart.microgonsEarned).toBe(10000);

      const worker1Part = noteRecipients.find(x => x.address === worker1.address);
      expect(worker1Part.microgonsEarned).toBe(20000);
      expect(worker1Part.microgonsEarned).toBeTruthy();

      const worker2Part = noteRecipients.find(x => x.address === worker2.address);
      expect(worker2Part.microgonsEarned).toBe(30000);
      expect(worker2Part.microgonsEarned).toBeTruthy();

      const worker3Part = noteRecipients.find(x => x.address === worker3.address);
      expect(worker3Part).not.toBeTruthy();

      expect(funding.microgons).toBe(200e3 * client.micronoteBatchFunding.queryFundingToPreload);
      const microgonsUsed = 60e3 + config.micronoteBatch.settlementFeeMicrogons;
      expect(funding.microgonsAllocated).toBe(microgonsUsed);
    });
  }
}, 30000);

test('can create multiple holds on a micronote', async () => {
  const client = new Client();
  await client.register();
  await client.grantCentagons(2500);

  const lead = new Client();
  const worker1 = new Client();
  const worker2 = new Client();

  const { id, batchSlug } = await client.createMicronote(12000);

  const hold1 = await lead.runSignedByIdentity('Micronote.hold', {
    id,
    batchSlug,
    identity: lead.identity,
    microgons: 5000,
  });

  expect(hold1.holdAuthorizationCode).toBeTruthy();
  expect(hold1.remainingBalance).toBe(12000 - 5000 - config.micronoteBatch.settlementFeeMicrogons);

  const subHold = await worker1.runSignedByIdentity('Micronote.hold', {
    id,
    holdAuthorizationCode: hold1.holdAuthorizationCode,
    batchSlug,
    identity: worker1.identity,
    microgons: 2500,
  });

  expect(subHold.holdAuthorizationCode).not.toBeTruthy();
  expect(subHold.holdId).toBeTruthy();
  expect(subHold.remainingBalance).toBe(
    12000 - 5000 - 2500 - config.micronoteBatch.settlementFeeMicrogons,
  );

  // can't hold more than available
  const failedSubHold2 = await worker2.runSignedByIdentity('Micronote.hold', {
    id,
    holdAuthorizationCode: hold1.holdAuthorizationCode,
    batchSlug,
    identity: worker2.identity,
    microgons: 7500,
  });

  expect(failedSubHold2.holdAuthorizationCode).not.toBeTruthy();
  expect(failedSubHold2.holdId).not.toBeTruthy();
  expect(failedSubHold2.accepted).not.toBeTruthy();
  expect(failedSubHold2.remainingBalance).toBe(
    12000 - 5000 - 2500 - config.micronoteBatch.settlementFeeMicrogons,
  );

  // check a valid second hold
  const subHold2 = await worker2.runSignedByIdentity('Micronote.hold', {
    id,
    holdAuthorizationCode: hold1.holdAuthorizationCode,
    batchSlug,
    identity: worker2.identity,
    microgons: 2000,
  });
  expect(subHold2.holdId).toBeTruthy();
  expect(subHold2.remainingBalance).toBe(
    12000 - 2000 - 5000 - 2500 - config.micronoteBatch.settlementFeeMicrogons,
  );

  // worker 2 should not be able to finalize
  await expect(
    worker2.runSignedByIdentity('Micronote.settle', {
      holdId: subHold2.holdId,
      isFinal: true,
      identity: worker2.identity,
      id,
      batchSlug,
      tokenAllocation: {
        [worker2.address]: 2000,
      },
    }),
  ).rejects.toThrowError('only be finalized by the initial');

  // can't exceed balance
  await expect(
    worker2.runSignedByIdentity('Micronote.settle', {
      holdId: subHold2.holdId,
      isFinal: false,
      identity: worker2.identity,
      id,
      batchSlug,
      tokenAllocation: {
        [worker2.address]: 8000,
      },
    }),
  ).rejects.toThrowError('exceeds micronote allocation');

  // can claim more than hold
  const settleHold2 = await worker2.runSignedByIdentity('Micronote.settle', {
    holdId: subHold2.holdId,
    isFinal: false,
    identity: worker2.identity,
    id,
    batchSlug,
    tokenAllocation: {
      [worker2.address]: 3000,
    },
  });
  expect(settleHold2.finalCost).toBe(3000);

  // can't settle a hold twice
  await expect(
    worker2.runSignedByIdentity('Micronote.settle', {
      holdId: subHold2.holdId,
      isFinal: false,
      identity: worker2.identity,
      id,
      batchSlug,
      tokenAllocation: {
        [worker2.address]: 2600,
      },
    }),
  ).rejects.toThrowError();

  // finalize note
  const final = await lead.runSignedByIdentity('Micronote.settle', {
    holdId: hold1.holdId,
    isFinal: true,
    identity: lead.identity,
    id,
    batchSlug,
    tokenAllocation: {
      [lead.address]: 5001,
    },
  });
  expect(final.finalCost).toBe(5001 + settleHold2.finalCost + config.micronoteBatch.settlementFeeMicrogons);

  await expect(
    worker1.runSignedByIdentity('Micronote.settle', {
      holdId: subHold.holdId,
      isFinal: false,
      identity: worker1.identity,
      id,
      batchSlug,
      tokenAllocation: {
        [worker1.address]: 2600,
      },
    }),
  ).rejects.toThrowError('already been finalized');

  await expect(
    worker1.runSignedByIdentity('Micronote.hold', {
      id,
      holdAuthorizationCode: hold1.holdAuthorizationCode,
      batchSlug,
      identity: worker1.identity,
      microgons: 2000,
    }),
  ).rejects.toThrowError('already been finalized');
});

afterAll(async () => {
  await stop();
});
