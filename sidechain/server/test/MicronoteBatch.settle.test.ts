import { hashObject, sha3 } from '@ulixee/commons/lib/hashUtils';
import { IBlockSettings, NoteType } from '@ulixee/specification';
import { nanoid } from 'nanoid';
import ArgonUtils from '@ulixee/sidechain/lib/ArgonUtils';
import PgPool, { DbType } from '@ulixee/payment-utils/pg/PgPool';
import BlockManager from '../main/lib/BlockManager';
import MicronoteBatchManager from '../main/lib/MicronoteBatchManager';
import RegisteredAddress from '../main/models/RegisteredAddress';
import MicronoteBatch from '../main/models/MicronoteBatch';
import MicronoteBatchOutput from '../main/models/MicronoteBatchOutput';
import Note, { INoteRecord } from '../main/models/Note';
import MainDb from '../main/db';
import { cleanDb, mockGenesisTransfer, start, stop } from './_setup';
import Client from './_TestClient';
import { IMicronoteFundsRecord } from '../batch/models/MicronoteFunds';
import { IMicronoteDisbursementssRecord, IMicronoteRecord } from '../batch/models/Micronote';
import BatchDb from '../batch/db';

let batchDb: PgPool<DbType.Batch>;
let batch: MicronoteBatch;

beforeAll(async () => {
  await start();
});

beforeEach(async () => {
  await cleanDb();
  await mockGenesisTransfer();
  await MicronoteBatchManager.createNewBatches();
  // @ts-ignore
  BlockManager.settingsLoader = {
    isResolved: true,
    promise: Promise.resolve({ height: 5, hash: '1' } as unknown as IBlockSettings),
  };

  batch = await MicronoteBatchManager.get();
  // eslint-disable-next-line jest/no-standalone-expect
  expect(batch).toBeTruthy();

  batchDb = await BatchDb.get(batch.slug);
  // eslint-disable-next-line jest/no-standalone-expect
  expect(batchDb).toBeTruthy();
}, 10000);

test('should not allow a micronote batch to submit a close request that would result in a negative balance', async () => {
  try {
    const apiClient = new Client(batch.credentials.identity);
    await apiClient.grantCentagons(250);

    {
      const wallet = new Client();
      await createWalletMicronoteFunds(wallet, 120e4, 20e4);
      await createLedgerOutput(wallet, 80);
    }
    {
      const wallet = new Client();
      await createWalletMicronoteFunds(wallet, 130e4, 45e4);
      await createLedgerOutput(wallet, 130 - 45);
    }
    {
      const wallet = new Client();
      await createLedgerOutput(wallet, 23);
    }
    {
      const wallet = new Client();
      await createLedgerOutput(wallet, 5);
    }
    {
      const wallet = new Client();
      await createLedgerOutput(wallet, 2);
    }

    // @ts-expect-error
    await MicronoteBatchManager.settleBatch(batch.address);
  } catch (err) {
    expect(err.code).toBe('ERR_NSF');
  }
  await batchDb.shutdown();
  await MainDb.query(`DROP DATABASE ${BatchDb.getName(batch.slug)}`);
}, 10000);

test('should allow a micronote batch to settle', async () => {
  const startBalance = await MainDb.transaction(c =>
    RegisteredAddress.getBalance(c, batch.data.address),
  );
  fundCounter = 0;
  expect(startBalance.toString()).toBe('0');

  const batchClient = new Client(batch.credentials.identity);

  await batchClient.grantCentagons(51e2);
  const [wallet1, wallet2, wallet3, wallet4] = [
    new Client(),
    new Client(),
    new Client(),
    new Client(),
  ];

  await createWalletMicronoteFunds(wallet1, 10e6, 10e6);
  await createWalletMicronoteFunds(wallet1, 11e6, 10e6);
  await createWalletMicronoteFunds(wallet2, 10e6, 10e6);
  await createWalletMicronoteFunds(wallet3, 10e6, 9e6);
  await createWalletMicronoteFunds(wallet4, 10e6, 10e6);
  await createLedgerOutput(wallet1, Math.floor(20e2 * 0.8));
  await createLedgerOutput(wallet2, Math.floor(10e2 * 0.8));
  await createLedgerOutput(wallet3, Math.floor(10e2 * 0.8));
  await createLedgerOutput(wallet4, Math.floor(9e2 * 0.8), 4);

  // @ts-expect-error
  await MicronoteBatchManager.settleBatch(batch.address);

  // check for output to the micronote batch output key
  await MainDb.transaction(async client => {
    const output = await MicronoteBatchOutput.load(client, batch.address);
    expect(output).toBeTruthy();
    expect(output.data.newNotesHash).toBeTruthy();
    expect(output.data.newNotesCount).toBe(4);

    const transactions = await client.list<INoteRecord>('select * from notes', null);
    expect(transactions).toHaveLength(6);

    const mostRecent = await Note.findMostRecentGuaranteeForAddress(client, wallet4.address);
    expect(mostRecent).toBe(4);
  });
});

afterAll(async () => {
  await stop();
});

let counter = 0;

const createLedgerOutput = (wallet: Client, centagons, guaranteeBlockHeight = 0) => {
  const record: Partial<INoteRecord> = {
    centagons,
    toAddress: wallet.address,
    fromAddress: batch.address,
    timestamp: new Date(),
    type: NoteType.revenue,
  };
  record.noteHash = hashObject(record);
  record.signature = {} as any;
  record.guaranteeBlockHeight = guaranteeBlockHeight;

  return batchDb.transaction(async x => {
    // tslint:disable-next-line:no-increment-decrement
    const id = `note${counter++}`;
    await x.insert<IMicronoteRecord>('micronotes', {
      blockHeight: 1,
      lockedTime: new Date(),
      clientAddress: wallet.address,
      fundsId: '1'.padEnd(30, '0'),
      nonce: Buffer.from('nonce'),
      microgonsAllocated: Math.ceil(ArgonUtils.centagonsToMicrogons(centagons) / 0.8),
      isAuditable: true,
      hasSettlements: true,
      id,
      holdAuthorizationCode: '1',
    });
    await x.insert<IMicronoteDisbursementssRecord>('micronote_disbursements', {
      createdTime: new Date(),
      microgonsEarned: Math.ceil(ArgonUtils.centagonsToMicrogons(centagons) / 0.8) - 10,
      micronoteId: id,
      address: wallet.address,
    });
    return x.insert<INoteRecord>('note_outputs', record);
  });
};

let fundCounter = 0;
const createWalletMicronoteFunds = (wallet, microgons, allocated) => {
  return batchDb.transaction(x =>
    x.insert<IMicronoteFundsRecord>('micronote_funds', {
      id: `${(fundCounter += 1)}`.padEnd(30, '0'),
      address: wallet.address,
      noteHash: sha3(nanoid()),
      microgons,
      microgonsAllocated: allocated,
      guaranteeBlockHeight: 0,
    }),
  );
};
