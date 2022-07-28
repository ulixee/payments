import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { ITransaction, NoteType } from '@ulixee/specification';
import config from '../config';
import buildTransactionTransferOut from '../main/lib/buildTransactionTransferOut';
import MainchainBlock from '../main/models/MainchainBlock';
import Note from '../main/models/Note';
import Security from '../main/models/Security';
import MainDb from '../main/db';
import { setupDb, stop } from './_setup';
import TestClient from './_TestClient';

const mainchainAddressSigner = config.mainchain.addresses[0];
const mainchainAddress = mainchainAddressSigner.bech32;
let userAddress2: TestClient;
let userAddress: TestClient;
let sidechainFunds: Security;

beforeAll(async () => {
  await setupDb();
  userAddress2 = new TestClient();
  userAddress = new TestClient();
});

test('should spend outputs on "transfer out"', async () => {
  const existingTxHash = sha3('should store an outbound hash');
  await MainDb.transaction(async client => {
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
      toAddress: userAddress.address,
      fromAddress: mainchainAddress,
      transactionTime: new Date(),
      confirmedBlockHeight: 6,
      transactionOutputAddress: userAddress.address,
      isToSidechain: false,
      isBurn: false,
    }).save();

    sidechainFunds = await new Security(client, {
      centagons: 10000n,
      transactionHash: existingTxHash,
      transactionOutputIndex: 1,
      toAddress: mainchainAddress,
      fromAddress: mainchainAddress,
      transactionTime: new Date(),
      confirmedBlockHeight: 6,
      transactionOutputAddress: mainchainAddress,
      isToSidechain: true,
      isBurn: false,
    }).save();

    await new Security(client, {
      centagons: 250n,
      transactionHash: existingTxHash,
      transactionOutputIndex: 2,
      toAddress: userAddress2.address,
      fromAddress: mainchainAddress,
      transactionTime: new Date(),
      confirmedBlockHeight: 6,
      transactionOutputAddress: userAddress2.address,
      isToSidechain: false,
      isBurn: false,
    }).save();
  });

  let transaction: ITransaction;
  await MainDb.transaction(async client => {
    const data1 = Note.addSignature(
      {
        fromAddress: mainchainAddress,
        toAddress: userAddress.address,
        centagons: 100n,
        timestamp: new Date(),
        type: NoteType.transferOut,
      },
      mainchainAddressSigner,
    );
    const microTx = await new Note(client, data1).saveUnchecked(0);

    const microTx2data = Note.addSignature(
      {
        fromAddress: mainchainAddress,
        toAddress: userAddress2.address,
        centagons: 20n,
        timestamp: new Date(),
        type: NoteType.transferOut,
      },
      mainchainAddressSigner,
    );
    const microTx2 = await new Note(client, microTx2data).saveUnchecked(0);

    const out = await buildTransactionTransferOut(client, [
      {
        centagons: 100n,
        address: userAddress.address,
        noteHash: microTx.data.noteHash,
      },
      {
        centagons: 20n,
        address: userAddress2.address,
        noteHash: microTx2.data.noteHash,
      },
    ]);
    expect(out.centagons).toBe(120n);
    transaction = out.transaction;
    expect(transaction.outputs).toHaveLength(3);
  });

  // 3. check that old transactions were "spent"
  await MainDb.transaction(async client => {
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
