import { hashObject, sha3 } from '@ulixee/commons/lib/hashUtils';
import IBlockSettings from '@ulixee/block-utils/interfaces/IBlockSettings';
import { NoteType } from '@ulixee/specification';
import { nanoid } from 'nanoid';
import BlockManager from '../main/lib/BlockManager';
import MicronoteBatchManager from '../main/lib/MicronoteBatchManager';
import Wallet from '../main/models/Wallet';
import MicronoteBatch from '../main/models/MicronoteBatch';
import MicronoteBatchOutput from '../main/models/MicronoteBatchOutput';
import Note, { INoteRecord } from '../main/models/Note';
import MainDb from '../main/db';
import PgPool, { DbType } from '../utils/PgPool';
import { cleanDb, mockGenesisTransfer, setupDb, stop } from './_setup';
import Client from './_TestClient';
import { IMicronoteFundsRecord } from '../batch/models/MicronoteFunds';
import { IMicronoteRecipientsRecord, IMicronoteRecord } from '../batch/models/Micronote';
import BatchDb from '../batch/db';

let batchDb: PgPool<DbType.Batch>;
let batch: MicronoteBatch;

beforeAll(async () => {
  await setupDb();
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

test('should allow a micronote batch to close', async () => {
  const startBalance = await MainDb.transaction(c => Wallet.getBalance(c, batch.data.address));
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

    const mostRecent = await Note.findMostRecentForWallet(client, wallet4.address);
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
      claimedTime: new Date(),
      clientAddress: wallet.address,
      fundsId: 1,
      nonce: Buffer.from('nonce'),
      microgonsAllocated: Math.ceil(Number(centagons * 10e3) / 0.8),
      isAuditable: true,
      id,
    });
    await x.insert<IMicronoteRecipientsRecord>('micronote_recipients', {
      createdTime: new Date(),
      microgonsEarned: Math.ceil(Number(centagons * 10e3) / 0.8) - 10,
      micronoteId: id,
      address: wallet.address,
    });
    return x.insert<INoteRecord>('note_outputs', record);
  });
};

const createWalletMicronoteFunds = (wallet, microgons, allocated) => {
  const record: Partial<IMicronoteFundsRecord> = {
    address: wallet.address,
    noteHash: sha3(nanoid()),
    microgons,
    microgonsAllocated: allocated,
    guaranteeBlockHeight: 0,
  };

  return batchDb.transaction(x => x.insert('micronote_funds', record));
};
