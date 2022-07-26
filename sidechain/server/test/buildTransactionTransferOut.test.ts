import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { ITransaction, NoteType } from '@ulixee/specification';
import config from '../config';
import buildTransactionTransferOut from '../lib/buildTransactionTransferOut';
import MainchainBlock from '../models/MainchainBlock';
import Note from '../models/Note';
import Security from '../models/Security';
import db from '../lib/defaultDb';
import { setupDb, stop } from './_setup';
import TestClient from './_TestClient';

const mainchainWallet = config.mainchain.wallets[0];
let userKeys2: TestClient;
let userKeys: TestClient;
let sidechainFunds: Security;

beforeAll(async () => {
  await setupDb();
  userKeys2 = new TestClient();
  userKeys = new TestClient();
});

test('should spend outputs on "transfer out"', async () => {
  const existingTxHash = sha3('should store an outbound hash');
  await db.transaction(async client => {
    await new MainchainBlock(client, {
      blockHash: sha3('6'),
      isLongestChain: true,
      height: 5,
      nextLinkTarget: {
        powerOf2: 256,
      },
    }).save();

    await new Security(client, {
      centagons: 1234n,
      transactionHash: existingTxHash,
      transactionOutputIndex: 0,
      toAddress: userKeys.address,
      fromAddress: mainchainWallet.address,
      transactionTime: new Date(),
      confirmedBlockHeight: 6,
      transactionOutputAddress: userKeys.address,
      isToSidechain: false,
      isBurn: false,
    }).save();

    sidechainFunds = await new Security(client, {
      centagons: 10000n,
      transactionHash: existingTxHash,
      transactionOutputIndex: 1,
      toAddress: mainchainWallet.address,
      fromAddress: mainchainWallet.address,
      transactionTime: new Date(),
      confirmedBlockHeight: 6,
      transactionOutputAddress: mainchainWallet.address,
      isToSidechain: true,
      isBurn: false,
    }).save();

    await new Security(client, {
      centagons: 250n,
      transactionHash: existingTxHash,
      transactionOutputIndex: 2,
      toAddress: userKeys2.address,
      fromAddress: mainchainWallet.address,
      transactionTime: new Date(),
      confirmedBlockHeight: 6,
      transactionOutputAddress: userKeys2.address,
      isToSidechain: false,
      isBurn: false,
    }).save();
  });

  let transaction: ITransaction;
  await db.transaction(async client => {
    const data1 = Note.addSignature(
      {
        fromAddress: mainchainWallet.address,
        toAddress: userKeys.address,
        centagons: 100n,
        timestamp: new Date(),
        type: NoteType.transferOut,
      },
      mainchainWallet,
    );
    const microTx = await new Note(client, data1).saveUnchecked(0);

    const microTx2data = Note.addSignature(
      {
        fromAddress: mainchainWallet.address,
        toAddress: userKeys2.address,
        centagons: 20n,
        timestamp: new Date(),
        type: NoteType.transferOut,
      },
      mainchainWallet,
    );
    const microTx2 = await new Note(client, microTx2data).saveUnchecked(0);

    const out = await buildTransactionTransferOut(client, [
      {
        centagons: 100n,
        address: userKeys.address,
        noteHash: microTx.data.noteHash,
      },
      {
        centagons: 20n,
        address: userKeys2.address,
        noteHash: microTx2.data.noteHash,
      },
    ]);
    expect(out.centagons).toBe(120n);
    transaction = out.transaction;
    expect(transaction.outputs).toHaveLength(3);
  });

  // 3. check that old transactions were "spent"
  await db.transaction(async client => {
    const mainchainSecurities = await Security.find(
      client,
      transaction.transactionHash,
    );
    expect(mainchainSecurities).toHaveLength(3);

    const funds = (await Security.find(client, sidechainFunds.data.transactionHash)).find(
      x => x.data.isToSidechain,
    );
    expect(funds.data.spentOnTransactionHash).toEqual(mainchainSecurities[0].data.transactionHash);
  });
});

afterAll(async () => {
  await stop();
});
