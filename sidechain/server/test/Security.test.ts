import { sha3 } from '@ulixee/commons/lib/hashUtils';
import IBlockSettings from '@ulixee/block-utils/interfaces/IBlockSettings';
import TransactionBuilder from '@ulixee/wallet/lib/TransactionBuilder';
import { LedgerType, NoteType, TransactionType } from '@ulixee/specification';
import config from '../config';
import BlockManager from '../main/lib/BlockManager';
import Wallet from '../main/models/Wallet';
import MainchainBlock from '../main/models/MainchainBlock';
import Note from '../main/models/Note';
import Security, { ISecurityRecord } from '../main/models/Security';
import MainDb from '../main/db';
import { cleanDb, grantCentagons, mockGenesisTransfer, setupDb, stop } from './_setup';
import TestClient from './_TestClient';
import SecurityMainchainBlock from '../main/models/SecurityMainchainBlock';

let client1: TestClient;
const sidechainAddress = config.mainchain.addresses[0].bech32;
let clientAddress: string;

beforeAll(async () => {
  await setupDb();
  await mockGenesisTransfer();

  client1 = new TestClient();
  clientAddress = client1.address;

  // @ts-ignore
  BlockManager.settingsLoader = {
    isResolved: true,
    promise: Promise.resolve({ height: 5, hash: '1' } as unknown as IBlockSettings),
  };

  const address = client1.address;
  await MainDb.transaction(async client => {
    const blockHash = sha3('block1');
    await new MainchainBlock(client, {
      height: 0,
      blockHash,
      isLongestChain: true,
      nextLinkTarget: {
        powerOf2: 256,
      },
    }).save();

    // create funds
    await new Security(client, {
      transactionHash: sha3('1'),
      transactionOutputIndex: 0,
      transactionOutputAddress: address,
      transactionTime: new Date(),
      centagons: 1n,
      confirmedBlockHeight: 0,
      fromAddress: clientAddress,
      toAddress: sidechainAddress,
      isToSidechain: true,
      isTransferIn: true,
    }).save();

    await new Security(client, {
      transactionHash: sha3('2'),
      transactionOutputIndex: 0,
      transactionOutputAddress: address,
      transactionTime: new Date(),
      centagons: 2n,
      confirmedBlockHeight: 0,
      fromAddress: clientAddress,
      toAddress: sidechainAddress,
      isToSidechain: true,
      isTransferIn: true,
    }).save({
      blockHash,
      blockHeight: 0,
      blockStableLedgerIndex: 0,
    });

    await new Security(client, {
      transactionHash: sha3('3'),
      transactionOutputIndex: 0,
      transactionOutputAddress: address,
      transactionTime: new Date(),
      centagons: 1n,
      confirmedBlockHeight: 0,
      fromAddress: clientAddress,
      toAddress: sidechainAddress,
      isToSidechain: true,
      isTransferIn: true,
    }).save();

    await new Security(client, {
      transactionHash: sha3('3'),
      transactionOutputIndex: 1,
      transactionOutputAddress: address,
      transactionTime: new Date(),
      centagons: 23n,
      confirmedBlockHeight: 0,
      fromAddress: sidechainAddress,
      toAddress: 'someone else',
      isToSidechain: false,
    }).save();

    await new Security(client, {
      transactionHash: sha3('4'),
      transactionOutputIndex: 0,
      transactionOutputAddress: address,
      transactionTime: new Date(),
      centagons: 1n,
      confirmedBlockHeight: 0,
      fromAddress: clientAddress,
      toAddress: sidechainAddress,
      isToSidechain: true,
      isTransferIn: true,
    }).save();

    await new Security(client, {
      transactionHash: sha3('6'),
      transactionOutputIndex: 0,
      transactionOutputAddress: address,
      transactionTime: new Date(),
      centagons: 1n,
      confirmedBlockHeight: 0,
      fromAddress: clientAddress,
      toAddress: sidechainAddress,
      isToSidechain: true,
    }).save();

    // unspendable
    await new Security(client, {
      transactionHash: sha3('5'),
      transactionOutputIndex: 0,
      transactionOutputAddress: address,
      transactionTime: new Date(),
      centagons: 4n,
      fromAddress: clientAddress,
      toAddress: sidechainAddress,
      isToSidechain: true,
      isTransferIn: true,
    }).save();
  });
});

test('should error if too many funds are locked up', async () => {
  await MainDb.transaction(async client => {
    try {
      const try1 = await Security.lockUnspentFunds(client, 6n);
      expect(try1).not.toBeTruthy();
    } catch (err) {
      expect(err).toBeTruthy();
    }
  });
});

test('should be able to lock up a complete amount of funding', async () => {
  await MainDb.transaction(async client => {
    const unspent = await Security.lockUnspentFunds(client, 4n);
    expect(unspent.outputs).toHaveLength(4);
    expect(unspent.change).toBe(0n);
  });
});

test('should be able to grab unspent funds concurrently', async () => {
  await MainDb.transaction(async client => {
    const unspent = await Security.lockUnspentFunds(client, 4n);
    await MainDb.transaction(async client2 => {
      const lockedFunds = await Security.lockUnspentFunds(client2, 1n);
      expect(lockedFunds.outputs).toHaveLength(1);
      expect(
        lockedFunds.outputs.filter(x =>
          unspent.outputs.find(
            y =>
              x.transactionOutputIndex === y.transactionOutputIndex &&
              x.transactionHash.equals(y.transactionHash),
          ),
        ),
      ).toHaveLength(0);
      expect(lockedFunds.change).toBe(1n);
    });
  });
});

test('should create proper unspent outputs when some money is returned to users', async () => {
  await grantCentagons(5n, clientAddress);

  let startMainchainFundRecords = 0;

  await MainDb.transaction(async client => {
    const { count } = await client.queryOne('select count(*) as count from securities');
    startMainchainFundRecords = Number(count);
    const unspent = await Security.lockUnspentFunds(client, 4);
    // build transaction from unspent outputs
    const builder = new TransactionBuilder(TransactionType.TRANSFER, LedgerType.STABLE);
    builder.addOutput({ address: clientAddress, centagons: 4n });
    for (const output of unspent.outputs) {
      builder.addSource(
        {
          sourceLedger: LedgerType.STABLE,
          sourceOutputIndex: output.transactionOutputIndex,
          sourceTransactionHash: output.transactionHash,
        },
        output.centagons,
        config.mainchain.addresses[0],
      );
    }
    const microdata = await Note.addSignature(
      {
        toAddress: sidechainAddress,
        fromAddress: clientAddress,
        centagons: 4n,
        timestamp: new Date(),
        type: NoteType.transfer,
      },
      client1.credentials.address,
    );
    const micro = new Note(client, microdata);
    await micro.saveUnchecked(0);

    await Security.recordSpend(
      client,
      [
        {
          centagons: 4n,
          address: clientAddress,
          noteHash: microdata.noteHash,
          outIndex: 0,
        },
      ],
      unspent.outputs,
      builder.finalize(),
      sidechainAddress,
      false,
    );
  });

  await MainDb.transaction(async client => {
    const balance = await Wallet.getBalance(client, clientAddress);
    expect(balance).toBe(1n);
  });

  await MainDb.transaction(async client => {
    const mainchainSecurities = await client.list<ISecurityRecord>('select * from securities');
    expect(mainchainSecurities).toHaveLength(startMainchainFundRecords + 1);

    const transferOut = mainchainSecurities.filter(x => x.toAddress === clientAddress);
    expect(transferOut).toHaveLength(1);
    expect(transferOut[0].centagons).toBe(4n);
  });
});

test('should record blocks where securities are found', async () => {
  await cleanDb();
  await mockGenesisTransfer();

  const transactionHash = sha3('tx1');
  await MainDb.transaction(async client => {
    function createBlock(
      hash: string,
      height: number,
      isLongestChain: boolean,
      prevBlockHash?: string,
    ) {
      return new MainchainBlock(client, {
        height,
        prevBlockHash: prevBlockHash ? sha3(prevBlockHash) : null,
        blockHash: sha3(hash),
        isLongestChain,
        nextLinkTarget: { powerOf2: 256 },
      }).save();
    }

    await createBlock('gen', 0, true);
    await createBlock('1', 1, true, 'gen');
    await createBlock('2', 2, true, '1');
    await createBlock('3', 3, true, '2');
    await createBlock('4', 4, true, '3');
    await createBlock('5', 5, true, '4');
    await createBlock('6', 6, true, '5');
    await createBlock('7', 7, true, '6');
    await createBlock('8', 8, true, '7');
    await createBlock('9', 9, true, '8');
    await createBlock('10', 10, true, '9');
    await createBlock('11', 11, true, '10');

    // fork off 1
    await createBlock('2a', 2, false, '1');
    await createBlock('3a', 3, false, '2a');
    await createBlock('4a', 4, false, '3a');
    await createBlock('5a', 5, false, '4a');
    await createBlock('6a', 6, false, '5a');
    await createBlock('7a', 7, false, '6a');
    await createBlock('8a', 8, false, '7a');
    await createBlock('9a', 9, false, '8a');
    await createBlock('10a', 10, false, '9a');

    await new Security(client, {
      transactionHash,
      transactionOutputIndex: 0,
      transactionOutputAddress: client1.address,
      transactionTime: new Date(),
      centagons: 100n,
      fromAddress: clientAddress,
      toAddress: sidechainAddress,
      isToSidechain: true,
      isTransferIn: true,
    }).save();
  });

  await MainDb.transaction(async client => {
    const securities = await client.list<ISecurityRecord>('select * from securities');
    expect(securities).toHaveLength(1);

    await Security.recordConfirmedSecurities(client, 11);

    {
      const security = await client.queryOne<ISecurityRecord>(
        'select * from securities where transaction_hash=$1',
        [transactionHash],
      );
      expect(security.confirmedBlockHeight).toBeNull();
      expect(security.noteHash).toBeNull();
    }

    await SecurityMainchainBlock.record(client, {
      blockStableLedgerIndex: 0,
      blockHeight: 5,
      blockHash: sha3('5a'),
      transactionHash,
    });

    // should not break if we record twice
    await SecurityMainchainBlock.record(client, {
      blockStableLedgerIndex: 0,
      blockHeight: 5,
      blockHash: sha3('5a'),
      transactionHash,
    });

    await Security.recordConfirmedSecurities(client, 12);
    {
      const security = await client.queryOne<ISecurityRecord>(
        'select * from securities where transaction_hash=$1',
        [transactionHash],
      );
      expect(security.confirmedBlockHeight).toBeNull();
    }

    await SecurityMainchainBlock.record(client, {
      blockStableLedgerIndex: 0,
      blockHeight: 6,
      blockHash: sha3('6'),
      transactionHash,
    });

    const blocks = await SecurityMainchainBlock.getRecordedBlocks(client, transactionHash);
    expect(blocks).toHaveLength(2);

    await Security.recordConfirmedSecurities(client, 12);
    {
      const security = await client.queryOne<ISecurityRecord>(
        'select * from securities where transaction_hash=$1',
        [transactionHash],
      );
      expect(security.confirmedBlockHeight).toBe(6);
      expect(security.noteHash).toBeTruthy();
    }
  });
});

afterAll(async () => {
  await stop();
});
