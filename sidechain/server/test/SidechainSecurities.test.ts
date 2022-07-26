import { sha3 } from '@ulixee/commons/lib/hashUtils';
import IBlockSettings from '@ulixee/block-utils/interfaces/IBlockSettings';
import { NoteType } from '@ulixee/specification';
import config from '../config';
import FundingTransferOutApi from '../endpoints/FundingTransfer.out';
import BlockManager from '../lib/BlockManager';
import SidechainSecurities from '../lib/SidechainSecurities';
import Wallet from '../models/Wallet';
import FundingTransferOut from '../models/FundingTransferOut';
import MainchainBlock, { IMainchainBlockRecord } from '../models/MainchainBlock';
import MicronoteBatch from '../models/MicronoteBatch';
import MicronoteBatchOutput from '../models/MicronoteBatchOutput';
import Note from '../models/Note';
import Security, { ISecurityRecord } from '../models/Security';
import db from '../lib/defaultDb';
import PgClient from '../lib/PgClient';
import { DbType } from '../lib/PgPool';
import { setupDb, stop } from './_setup';
import TestClient from './_TestClient';
import SecurityMainchainBlock from '../models/SecurityMainchainBlock';

let client1: TestClient;
let client2: TestClient;
let foundingMiner: TestClient;
const sidechainAddress = config.mainchain.wallets[0].address;
config.mainchain.fundingHoldBlocks = 2;

async function createBlock(
  client: PgClient<DbType.Default>,
  hash: string,
  height: number,
  isLongestChain: boolean,
  prevBlockHash?: string,
) {
  return await new MainchainBlock(client, {
    height,
    prevBlockHash: prevBlockHash ? sha3(prevBlockHash) : null,
    blockHash: sha3(hash),
    isLongestChain,
    nextLinkTarget: { powerOf2: 256 },
  }).save();
}

async function getBlock(client: PgClient<DbType.Default>, hash: string) {
  return await client.queryOne<IMainchainBlockRecord>(
    'select * from mainchain_blocks where block_hash=$1',
    [sha3(hash)],
  );
}

beforeAll(async () => {
  await setupDb();
  client1 = new TestClient();
  client2 = new TestClient();
  foundingMiner = new TestClient();
  await db.transaction(async client => {
    await createBlock(client, 'gen', 0, true);
    await createBlock(client, '1', 1, true, 'gen');
    await createBlock(client, '2', 2, true, '1');
    await createBlock(client, '3', 3, true, '2');

    await createBlock(client, '1a', 1, false, 'gen');
    await createBlock(client, '2a', 2, false, '1a');
    await createBlock(client, '3a', 3, false, '2a');

    await createBlock(client, '2b', 2, false, '1');
    await createBlock(client, '3b', 3, false, '2a');

    await new Security(client, {
      transactionHash: sha3('gentx'),
      transactionOutputIndex: 0,
      transactionOutputAddress: config.mainchain.wallets[0].address,
      transactionTime: new Date(),
      centagons: BigInt(150e5),
      fromAddress: foundingMiner.address,
      toAddress: sidechainAddress,
      isToSidechain: true,
      isTransferIn: true,
    }).save({
      blockHash: sha3('gen'),
      blockHeight: 0,
      blockStableLedgerIndex: 0,
    });

    await Security.recordConfirmedSecurities(client, 0);
  });
});

test('should create balanced funds for each chain', async () => {
  let block3a;
  let block3;
  // create funds
  await db.transaction(async client => {
    await new Security(client, {
      transactionHash: sha3('tx1'),
      transactionOutputIndex: 0,
      transactionOutputAddress: config.mainchain.wallets[0].address,
      transactionTime: new Date(),
      centagons: 150n,
      fromAddress: client1.address,
      toAddress: sidechainAddress,
      isToSidechain: true,
      isTransferIn: true,
    }).save({
      blockHash: sha3('1'),
      blockHeight: 1,
      blockStableLedgerIndex: 0,
    });

    await new Security(client, {
      transactionHash: sha3('tx2'),
      transactionOutputIndex: 0,
      transactionOutputAddress: config.mainchain.wallets[0].address,
      transactionTime: new Date(),
      centagons: 200n,
      fromAddress: client2.address,
      toAddress: sidechainAddress,
      isToSidechain: true,
      isTransferIn: true,
    }).save({
      blockHash: sha3('1a'),
      blockHeight: 1,
      blockStableLedgerIndex: 0,
    });

    block3a = await getBlock(client, '3a');
    block3 = await getBlock(client, '3');
    {
      const walletBalances = await Wallet.getAllBalances(client, 3, [], config.stakeWallet.address);
      {
        const sidechainSecurities = new SidechainSecurities(client, block3a);
        const result = await sidechainSecurities.createBlockOutput();
        expect(result.sidechainFunds).toHaveLength(1);

        expect(() =>
          SidechainSecurities.ensureZeroBalance(
            walletBalances.wallets,
            walletBalances.burnBalance,
            result.transferCentagons,
            walletBalances.sidechainFundingIn,
            result.sidechainFunds,
          ),
        ).not.toThrow();
      }
      {
        const sidechainSecurities = new SidechainSecurities(client, block3);
        const result = await sidechainSecurities.createBlockOutput();
        expect(result.sidechainFunds).toHaveLength(1);

        expect(() =>
          SidechainSecurities.ensureZeroBalance(
            walletBalances.wallets,
            walletBalances.burnBalance,
            result.transferCentagons,
            walletBalances.sidechainFundingIn,
            result.sidechainFunds,
          ),
        ).not.toThrow();
      }
    }

    {
      // now process funds
      await Security.recordConfirmedSecurities(client, 3);
      const walletBalances = await Wallet.getAllBalances(client, 3, [], config.stakeWallet.address);
      expect(walletBalances.wallets.find(x => x.address === client1.address).centagons).toBe(150n);
      // client 2 is not on longest chain yet
      expect(walletBalances.wallets.find(x => x.address === client2.address)).not.toBeTruthy();

      {
        const sidechainSecurities = new SidechainSecurities(client, block3a);
        const result = await sidechainSecurities.createBlockOutput();
        expect(result.sidechainFunds).toHaveLength(2);

        expect(() =>
          SidechainSecurities.ensureZeroBalance(
            walletBalances.wallets,
            walletBalances.burnBalance,
            result.transferCentagons,
            walletBalances.sidechainFundingIn,
            result.sidechainFunds,
          ),
        ).not.toThrow();
      }
      {
        const sidechainSecurities = new SidechainSecurities(client, block3);
        const result = await sidechainSecurities.createBlockOutput();
        expect(result.sidechainFunds).toHaveLength(2);

        expect(() =>
          SidechainSecurities.ensureZeroBalance(
            walletBalances.wallets,
            walletBalances.burnBalance,
            result.transferCentagons,
            walletBalances.sidechainFundingIn,
            result.sidechainFunds,
          ),
        ).not.toThrow();
      }
    }
  });
});

test('should handle burn transactions across forks', async () => {
  let micronoteBatch: MicronoteBatchOutput;
  await db.transaction(async client => {
    // now burn a batch on one chain

    const block4 = await createBlock(client, '4', 4, false, '3');

    const batch = await MicronoteBatch.create(client);
    const noteData = await Note.addSignature(
      {
        centagons: 250n,
        toAddress: batch.address,
        fromAddress: foundingMiner.address,
        type: NoteType.micronoteFunds,
      },
      foundingMiner.keyring,
    );
    await new Note(client, noteData).saveUnchecked(1);

    const burnNote = await Note.addSignature(
      {
        centagons: 250n,
        fromAddress: batch.address,
        toAddress: config.nullAddress,
        timestamp: new Date(),
        type: NoteType.burn,
      },
      batch.keyring,
    );
    await new Note(client, burnNote).saveUnchecked(3);

    micronoteBatch = await new MicronoteBatchOutput(client, {
      address: batch.address,
      startBlockHeight: 3,
      endBlockHeight: 4,
      guaranteeBlockHeight: 3,
      burnedCentagons: 250n,
      revenueMicrogons: BigInt(50e8),
      burnNoteHash: burnNote.noteHash,
      settledCentagons: BigInt(50e3),
      allocatedMicrogons: BigInt(51e8),
      newNotesHash: Buffer.from('1234'),
      newNotesCount: 500,
      settlementFeeCentagons: 10n,
      micronotesCount: 1,
      fundingMicrogons: BigInt(52e8),
    }).save();

    await batch.recordStateTime('settledTime');
    await batch.recordStateTime('closedTime');

    const sidechainSecurities = new SidechainSecurities(client, block4.data);
    const result = await sidechainSecurities.createBlockOutput();
    expect(result.sidechainFunds).toHaveLength(1);
    expect(result.burnTransactions).toHaveLength(1);
    expect(result.unburnedBatchOutputs).toHaveLength(1);
    expect(Buffer.from(result.unburnedBatchOutputs[0].address)).toEqual(
      Buffer.from(micronoteBatch.data.address),
    );
    expect(result.unburnedBatchOutputs[0].burnSecurityTransactionHash).toEqual(
      result.burnTransactions[0].transactionHash,
    );

    const walletBalances = await Wallet.getAllBalances(client, 4, [], config.stakeWallet.address);
    expect(() =>
      SidechainSecurities.ensureZeroBalance(
        walletBalances.wallets,
        walletBalances.burnBalance,
        result.transferCentagons,
        walletBalances.sidechainFundingIn,
        result.sidechainFunds,
      ),
    ).not.toThrow();

    await SecurityMainchainBlock.record(client, {
      transactionHash: result.sidechainFunds[0].transactionHash,
      blockStableLedgerIndex: 0,
      blockHeight: block4.data.height,
      blockHash: block4.data.blockHash,
    });
    await SecurityMainchainBlock.record(client, {
      transactionHash: result.burnTransactions[0].transactionHash,
      blockStableLedgerIndex: 0,
      blockHeight: block4.data.height,
      blockHash: block4.data.blockHash,
    });
  });

  await db.transaction(async client => {
    const block4a = await createBlock(client, '4a', 4, false, '3a');
    const sidechainSecurities = new SidechainSecurities(client, block4a.data);
    const result = await sidechainSecurities.createBlockOutput();
    expect(result.sidechainFunds).toHaveLength(1);
    expect(result.burnTransactions).toHaveLength(1);
    expect(result.unburnedBatchOutputs).toHaveLength(1);
    expect(result.unburnedBatchOutputs[0].address).toEqual(micronoteBatch.data.address);
    expect(result.unburnedBatchOutputs[0].burnSecurityTransactionHash).toEqual(
      result.burnTransactions[0].transactionHash,
    );

    const walletBalances = await Wallet.getAllBalances(client, 4, [], config.stakeWallet.address);
    expect(() =>
      SidechainSecurities.ensureZeroBalance(
        walletBalances.wallets,
        walletBalances.burnBalance,
        result.transferCentagons,
        walletBalances.sidechainFundingIn,
        result.sidechainFunds,
      ),
    ).not.toThrow();
  });
});

test('should handle transfers "out" across forks', async () => {
  // @ts-ignore
  BlockManager.settingsLoader = {
    isResolved: true,
    promise: Promise.resolve({
      height: 5,
      hash: sha3('5'),
    } as unknown as IBlockSettings),
  };

  await db.transaction(async client => {
    await createBlock(client, '5', 5, true, '4');
    const wallet2Balance = await Wallet.getBalance(client, client2.address);
    expect(wallet2Balance).toBe(0n);

    const client2Security = await client.queryOne<ISecurityRecord>(
      'select * from securities where from_address = $1',
      [client2.address],
    );
    expect(client2Security).toBeTruthy();

    await SecurityMainchainBlock.record(client, {
      transactionHash: client2Security.transactionHash,
      blockHash: sha3('1'),
      blockHeight: 1,
      blockStableLedgerIndex: 0,
    });

    await Security.recordConfirmedSecurities(client, 5);
  });

  await db.transaction(async client => {
    expect(await Wallet.getBalance(client, client2.address)).toBe(200n);
  });

  // now transfer out on 1 chain
  const noteData = await Note.addSignature(
    {
      centagons: 50n,
      toAddress: sidechainAddress,
      fromAddress: client2.address,
      type: NoteType.transferOut,
    },
    client2.keyring,
  );
  jest.spyOn(FundingTransferOutApi, 'validateWalletSignature').mockImplementationOnce(() => true);
  await FundingTransferOutApi.handler({
    note: noteData,
    signature: Buffer.from('test'),
    address: 'mrrobot',
  } as any);

  await db.transaction(async client => {
    const block5a = await createBlock(client, '5a', 5, false, '4a');
    const sidechainSecurities = new SidechainSecurities(client, block5a.data);
    const result = await sidechainSecurities.createBlockOutput();
    expect(result.sidechainFunds).toHaveLength(2); // 2 now that 150 is confirmed
    expect(result.burnTransactions).toHaveLength(1);
    expect(result.transfersOut).toHaveLength(1);
    expect(result.unburnedBatchOutputs).toHaveLength(1);
    expect(result.unburnedBatchOutputs[0].burnSecurityTransactionHash).toEqual(
      result.burnTransactions[0].transactionHash,
    );

    const walletBalances = await Wallet.getAllBalances(
      client,
      block5a.data.height,
      [],
      config.stakeWallet.address,
    );

    expect(() =>
      SidechainSecurities.ensureZeroBalance(
        walletBalances.wallets,
        walletBalances.burnBalance,
        result.transferCentagons,
        walletBalances.sidechainFundingIn,
        result.sidechainFunds,
      ),
    ).not.toThrow();

    const funding = await FundingTransferOut.find(client, noteData.noteHash);
    expect(funding.transactionHash).toBeTruthy();

    await SecurityMainchainBlock.record(client, {
      transactionHash: result.transfersOut[0].transactionHash,
      blockStableLedgerIndex: 0,
      blockHeight: block5a.data.height,
      blockHash: block5a.data.blockHash,
    });
    await SecurityMainchainBlock.record(client, {
      transactionHash: result.burnTransactions[0].transactionHash,
      blockStableLedgerIndex: 1,
      blockHeight: block5a.data.height,
      blockHash: block5a.data.blockHash,
    });
  });

  // now try on block 5, where the burn has already occurred
  await db.transaction(async client => {
    const block5 = await getBlock(client, '5');
    const sidechainSecurities = new SidechainSecurities(client, block5);
    const result = await sidechainSecurities.createBlockOutput();
    expect(result.sidechainFunds).toHaveLength(2);
    expect(result.burnTransactions).toHaveLength(0);
    expect(result.transfersOut).toHaveLength(1);
    expect(result.unburnedBatchOutputs).toHaveLength(0);

    const walletBalances = await Wallet.getAllBalances(client, 5, [], config.stakeWallet.address);
    expect(() =>
      SidechainSecurities.ensureZeroBalance(
        walletBalances.wallets,
        walletBalances.burnBalance,
        result.transferCentagons,
        walletBalances.sidechainFundingIn,
        result.sidechainFunds,
      ),
    ).not.toThrow();
  });
});

afterAll(async () => {
  await stop();
});
