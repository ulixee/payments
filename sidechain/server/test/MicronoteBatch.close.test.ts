import { IBlockSettings, NoteType } from '@ulixee/specification';
import Log from '@ulixee/commons/lib/Logger';
import PgPool, { DbType } from '@ulixee/payment-utils/pg/PgPool';
import config from '../config';
import BlockManager from '../main/lib/BlockManager';
import MicronoteBatchClose from '../batch/models/MicronoteBatch.close';
import MicronoteBatchManager from '../main/lib/MicronoteBatchManager';
import RegisteredAddress from '../main/models/RegisteredAddress';
import MicronoteBatch from '../main/models/MicronoteBatch';
import Note, { INoteRecord } from '../main/models/Note';
import mainDb from '../main/db';
import { mockGenesisTransfer, start, stop } from './_setup';
import Client from './_TestClient';
import { IMicronoteRecord } from '../batch/models/Micronote';
import MicronoteBatchDb from '../batch/db';
import { IMicronoteFundsRecord } from '../batch/models/MicronoteFunds';
import MicronoteBatchSettle from '../batch/models/MicronoteBatch.settle';

const { log: logger } = Log(module);

let clients: Client[] = [];
let loadWorker = null;
let workers = [];
let microNotes: IMicronoteRecord[] = [];
let batchDb: PgPool<DbType.Batch>;
let batch: MicronoteBatch;

beforeAll(async () => {
  await start();
  await mockGenesisTransfer();
  await MicronoteBatchManager.createNewBatches();
  batch = await MicronoteBatchManager.get();
  // eslint-disable-next-line jest/no-standalone-expect
  expect(batch).toBeTruthy();
  // @ts-ignore
  BlockManager.settingsLoader = {
    isResolved: true,
    promise: Promise.resolve({
      height: 5,
      hash: '1',
      minimumMicronoteBurnPercent: 20,
    } as unknown as IBlockSettings),
  };

  config.micronoteBatch.minimumFundingCentagons = 1n;

  batchDb = await MicronoteBatchDb.get(batch.slug);
  // eslint-disable-next-line jest/no-standalone-expect
  expect(batchDb).toBeTruthy();

  clients = [new Client(), new Client(), new Client()];
  const [client1, client2, client3] = clients;
  loadWorker = new Client();
  workers = [new Client(), new Client(), new Client()];
  const [worker1, worker2, worker3] = workers;
  await client1.register();
  await client2.register();
  await client3.register();

  await loadWorker.register();
  await worker1.register();
  await worker2.register();
  await worker3.register();

  await client1.grantCentagons(230e4);
  await client1.grantCentagons(210e4);
  await client1.grantCentagons(240e4);

  await client2.grantCentagons(130e4);
  await client2.grantCentagons(210e4);
  await client2.grantCentagons(440e4);

  await client3.grantCentagons(22);
  await client3.grantCentagons(133234);
  await client3.grantCentagons(999132334, 5);

  const createMicronote = async (client: Client, microgons: number) => {
    const note = await client.createMicronote(microgons);
    return {
      ...note,
      clientAddress: client.address,
      microgonsAllocated: microgons,
      guaranteeBlockHeight: 1,
      isAuditable: true,
    } as unknown as IMicronoteRecord;
  };

  microNotes = await Promise.all([
    createMicronote(client2, 11e4),
    createMicronote(client2, 23e4),
    createMicronote(client2, 22e4),
    createMicronote(client3, 23.3e4),
    createMicronote(client3, 120e4),
    createMicronote(client1, 11e4),
  ]);

  let counter = 0;
  for (const note of microNotes) {
    counter += 1;
    const client = clients.find(x => x.address === note.clientAddress);
    let remaining = note.microgonsAllocated - config.micronoteBatch.settlementFeeMicrogons;

    let firstHold = remaining;
    let secondHold = 0;

    if (counter === 2) {
      firstHold = 11e4;
      secondHold = 10e4;
      remaining -= secondHold;
    }

    const hold = await client.runSignedByIdentity('Micronote.hold', {
      id: note.id,
      batchSlug: batch.slug,
      identity: client.identity,
      microgons: firstHold,
    });
    if (counter === 2) {
      const hold2 = await client.runSignedByIdentity('Micronote.hold', {
        id: note.id,
        batchSlug: batch.slug,
        identity: client.identity,
        microgons: secondHold,
        holdAuthorizationCode: hold.holdAuthorizationCode,
      });
      await client.runSignedByIdentity('Micronote.settle', {
        id: note.id,
        batchSlug: batch.slug,
        identity: client.identity,
        isFinal: false,
        holdId: hold2.holdId,
        tokenAllocation: {
          [loadWorker.address]: secondHold,
        },
      });
    }

    const parts = {};
    for (const worker of workers) {
      parts[worker.address] = Math.floor(remaining / 5);
    }
    const noteClaim = await client.runSignedByIdentity('Micronote.settle', {
      id: note.id,
      holdId: hold.holdId,
      isFinal: counter !== 2,
      batchSlug: batch.slug,
      identity: client.identity,
      tokenAllocation: {
        [loadWorker.address]: Math.floor(remaining / 8),
        ...parts,
      },
    });
    // eslint-disable-next-line jest/no-standalone-expect
    expect(noteClaim).toBeTruthy();
  }
}, 15000);

const defaultNoteHashes = [];

test('should not run again if there is any data in the ledger outputs', async () => {
  await batchDb.transaction(async client => {
    const batchClose = new MicronoteBatchClose(
      client,
      batch.credentials.address,
      1n,
      defaultNoteHashes,
    );
    const hasRun = await batchClose.hasAlreadyRun();

    expect(hasRun).toBe(false);
  });
});

test('should make sure balances match the ledger', async () => {
  const [, client2] = clients;

  await mainDb.transaction(client => {
    const data = Note.addSignature(
      {
        fromAddress: client2.address,
        toAddress: batch.address,
        centagons: 11n,
        timestamp: new Date(),
        type: NoteType.micronoteFunds,
      },
      client2.credentials.address,
    );
    return new Note(client, data).saveUnchecked();
  });
  await mainDb.transaction(async defaultClient => {
    const balance = await RegisteredAddress.getBalance(defaultClient, batch.address);
    const hashes = await RegisteredAddress.getNoteHashes(defaultClient, batch.address);
    await batchDb.transaction(
      async client => {
        const batchClose = new MicronoteBatchClose(
          client,
          batch.credentials.address,
          balance,
          hashes,
        );
        logger.info('Finding orphaned transactions');
        // @ts-ignore
        await batchClose.findOrphanedFunding(defaultClient);

        // @ts-ignore
        const { missingHashes } = batchClose;
        expect(missingHashes).toHaveLength(1);
        {
          const orphans = await client.list<IMicronoteFundsRecord>(
            'select * from micronote_funds where address=$1 and note_hash = $2',
            [client2.address, missingHashes[0]],
          );
          expect(orphans).toHaveLength(1);
          const [orphan] = orphans;
          expect(orphan.microgons).toBe(11e4);
        }
      },
      { logger },
    );
  });
});

test('should close unfinished notes', async () => {
  const [client1] = clients;
  const { fund } = await client1.micronoteBatchFunding.reserveFunds(11e4);
  const mn = await client1.runSignedByAddress(`Micronote.create`, {
    batchSlug: batch.slug,
    address: client1.address,
    microgons: 9e4,
    fundsId: fund.fundsId,
  });
  microNotes.push(mn as any);

  await batchDb.transaction(
    async client => {
      const batchClose = new MicronoteBatchClose(
        client,
        batch.credentials.address,
        1n,
        defaultNoteHashes,
      );
      logger.info('Finished creating notes');
      // @ts-ignore
      await batchClose.refundMicronoteChange();
      // @ts-ignore
      const { unfinalizedMicronoteIds } = batchClose;
      expect(unfinalizedMicronoteIds).toHaveLength(2);
      {
        const openFunds = await client.list<IMicronoteFundsRecord>(
          'select * from micronote_funds where address=$1',
          [client1.address],
        );
        expect(openFunds).toHaveLength(1);
        expect(openFunds[0].microgonsAllocated).toBeLessThanOrEqual(9e4);
      }
    },
    { logger },
  );
});

test('should summarize the microgons allocated', async () => {
  await batchDb.transaction(
    async client => {
      const batchClose = new MicronoteBatchClose(
        client,
        batch.credentials.address,
        1n,
        defaultNoteHashes,
      );
      // @ts-ignore
      const microgons = await batchClose.verifyMicronoteFundAllocation();
      logger.info('Token summary', { microgons, sessionId: null });

      expect(microgons.funds).toBeGreaterThan(300e4);
      expect(microgons.allocated).toBeLessThanOrEqual(11e4 + 23e4 + 22e4 + 23.3e4 + 120e4 + 23e4);
      expect(microgons.settlementFees).toBe(
        microNotes.length * config.micronoteBatch.settlementFeeMicrogons,
      );
      expect(microgons.totalRevenue).toBe(microgons.allocated);
    },
    { logger },
  );
});

test('should properly create payouts', async () => {
  await batchDb.transaction(
    async client => {
      const batchClose = new MicronoteBatchClose(
        client,
        batch.credentials.address,
        1n,
        defaultNoteHashes,
      );
      // @ts-ignore
      await batchClose.loadMicronotePayments();
      // @ts-ignore
      await batchClose.loadFundingRefunds();
      // @ts-ignore
      await batchClose.createBurnNote();
      // @ts-ignore
      await batchClose.createSettlementFeeNote();
      // @ts-ignore
      await batchClose.saveLedgerOutputs();
    },
    { logger },
  );
  await mainDb.transaction(async defaultClient => {
    const wallet = await new RegisteredAddress(defaultClient, batch.address).load();
    await batchDb.transaction(
      async client => {
        const batchSettle = new MicronoteBatchSettle(client, batch.address);
        await batchSettle.run();
        const outputs = await client.list<INoteRecord>('select * from note_outputs');

        // not enough for settle fees
        expect(outputs).toHaveLength(8);
        // all took money from client 3
        expect(outputs.filter(x => x.guaranteeBlockHeight === 5)).toHaveLength(
          workers.length + 1 /* leadWorker*/ + 1 /* client3*/ + 1 /* burn*/,
        );
        const change = outputs.filter(x => x.type === NoteType.micronoteBatchRefund);
        expect(change).toHaveLength(3);
        const revenue = outputs.filter(x => x.type === NoteType.revenue);
        expect(revenue).toHaveLength(workers.length + 1);

        const settled = outputs.reduce((total, x) => total + x.centagons, 0n) * BigInt(1e4);

        // make sure generated transactions can be saved correctly
        const [firstOutput] = outputs;

        const note = new Note(defaultClient, firstOutput);
        await note.save(wallet);

        // payout should all go back out minus fees
        const fundsMinusSettled = Number(batchSettle.batchOutput.fundingMicrogons - settled);
        expect(fundsMinusSettled).toBeLessThan(
          [loadWorker, ...workers, ...clients].length * 1e4,
        );
        const burn = outputs.find(x => x.type === NoteType.burn);
        expect(burn.centagons).toEqual(batchSettle.batchOutput.burnedCentagons);
      },
      { logger },
    );
  });
});

test('should calculate settlement fees correctly', async () => {
  await batchDb.transaction(
    async client => {
      const queryOneMock = jest.spyOn(client, 'queryOne');
      const batchClose = new MicronoteBatchClose(
        client,
        batch.credentials.address,
        1n,
        defaultNoteHashes,
      );
      {
        queryOneMock.mockImplementationOnce(async () => {
          return { claims: 1000 };
        });
        // @ts-ignore
        const note = await batchClose.createSettlementFeeNote();

        expect(note).toBeTruthy();
        // should be 8
        expect(note.centagons).toBe(10n);
      }
      {
        queryOneMock.mockImplementationOnce(async () => {
          return { claims: 100 };
        });
        // @ts-ignore
        const note = await batchClose.createSettlementFeeNote();

        expect(note).toBeTruthy();
        // should be 1
        expect(note.centagons).toBe(1n);
      }
      {
        queryOneMock.mockImplementationOnce(async () => {
          return { claims: 99 };
        });
        // @ts-ignore
        const note = await batchClose.createSettlementFeeNote();

        expect(note).not.toBeTruthy();
      }
    },
    { logger },
  );
});

test('should burn 20% plus change', async () => {
  await batchDb.transaction(
    async client => {
      const listMock = jest.spyOn(client, 'list');
      const batchClose = new MicronoteBatchClose(
        client,
        batch.credentials.address,
        1n,
        defaultNoteHashes,
      );
      const payments = [
        { toAddress: '1', guaranteeBlockHeight: 1, microgons: 10000005n },
        { toAddress: '2', guaranteeBlockHeight: 1, microgons: 12000005n },
        { toAddress: '3', guaranteeBlockHeight: 1, microgons: 13009999n },
      ];
      // mock loadMicronotePayments
      listMock.mockImplementationOnce(async () => payments);

      // @ts-ignore
      await batchClose.loadMicronotePayments();

      // @ts-ignore
      const noteOutputs = batchClose.noteOutputs;
      expect(noteOutputs).toHaveLength(3);
      // @ts-ignore
      expect(noteOutputs.find(x => x.toAddress === '1').centagons).toBe(800n); // 1000 before burn
      expect(noteOutputs.find(x => x.toAddress === '2').centagons).toBe(960n); // 1200 before burn
      expect(noteOutputs.find(x => x.toAddress === '3').centagons).toBe(1040n); // 1300 before burn

      const microgonFunding = [
        { toAddress: '4', microgons: BigInt(20e4), guaranteeBlockHeight: 1 },
        { toAddress: '5', microgons: BigInt(1e4), guaranteeBlockHeight: 1 },
        { toAddress: '6', microgons: BigInt(9e3), guaranteeBlockHeight: 1 },
        { toAddress: '7', microgons: BigInt(19.999e3), guaranteeBlockHeight: 1 },
      ];
      // mock loadMicronotePayments
      listMock.mockImplementationOnce(async () => microgonFunding);
      // @ts-ignore
      await batchClose.loadFundingRefunds();

      expect(noteOutputs).toHaveLength(6); // 3 new ones
      // returns are floored
      expect(noteOutputs.find(x => x.toAddress === '4').centagons).toBe(20n);
      expect(noteOutputs.find(x => x.toAddress === '5').centagons).toBe(1n);
      expect(noteOutputs.find(x => x.toAddress === '7').centagons).toBe(1n);

      // mock loadMicronotePayments
      jest.spyOn(client, 'queryOne').mockImplementationOnce(async () => {
        return {
          totalFunding: BigInt(36e6),
        };
      });
      // @ts-ignore
      await batchClose.createBurnNote();
      const burn = noteOutputs[noteOutputs.length - 1];
      // should burn the rest
      expect(Number(burn.centagons)).toBe(3600 - 800 - 960 - 1040 - 20 - 1 - 1); // 778
    },
    { logger },
  );
});

test('should burn all money if no one exceeds 1 centagon', async () => {
  await batchDb.transaction(
    async client => {
      const listMock = jest.spyOn(client, 'list');
      const batchClose = new MicronoteBatchClose(
        client,
        batch.credentials.address,
        1n,
        defaultNoteHashes,
      );
      const payments = [
        { toAddress: '1', guaranteeBlockHeight: 1, microgons: 100n },
        { toAddress: '2', guaranteeBlockHeight: 1, microgons: 100n },
        { toAddress: '3', guaranteeBlockHeight: 1, microgons: 100n },
        { toAddress: '4', guaranteeBlockHeight: 1, microgons: 100n },
      ];
      // mock loadMicronotePayments
      listMock.mockImplementationOnce(async () => payments);
      // @ts-ignore
      await batchClose.loadMicronotePayments();

      // @ts-ignore
      const noteOutputs = batchClose.noteOutputs;
      expect(noteOutputs).toHaveLength(0);

      const microgonFunding = [
        { toAddress: '5', microgons: BigInt(9.6e3), guaranteeBlockHeight: 1 },
      ];
      // mock loadMicronotePayments
      listMock.mockImplementationOnce(async () => microgonFunding);
      // @ts-ignore
      await batchClose.loadFundingRefunds();

      expect(noteOutputs).toHaveLength(0); // 3 new ones

      // mock loadMicronotePayments
      jest.spyOn(client, 'queryOne').mockImplementationOnce(async () => {
        return {
          totalFunding: BigInt(1e4),
        };
      });
      // @ts-ignore
      await batchClose.createBurnNote();
      const burn = noteOutputs[noteOutputs.length - 1];
      // should burn the rest
      expect(burn.centagons).toBe(1n);
    },
    { logger },
  );
});

afterAll(async () => {
  await stop();
});
