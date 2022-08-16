import Constants from '@ulixee/block-utils/lib/Constants';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import MainchainClient from '@ulixee/mainchain';
import { IBlock, TransactionType } from '@ulixee/specification';
import config from '../config';
import BlockManager from '../main/lib/BlockManager';
import Security, { ISecurityRecord } from '../main/models/Security';
import MainDb from '../main/db';
import { setupDb, stop } from './_setup';
import TestClient from './_TestClient';
import { INoteRecord } from '../main/models/Note';
import { IMainchainBlockRecord } from '../main/models/MainchainBlock';
import SecurityMainchainBlock from '../main/models/SecurityMainchainBlock';

const mainchainAddress = config.mainchain.addresses[0].bech32;
let userClient: TestClient;
let userSidechainClient: TestClient;

beforeAll(async () => {
  await setupDb();
  userClient = new TestClient();
  userSidechainClient = new TestClient();
  config.mainchain.host = 'ws://127.0.0.1:2344';
});

afterAll(async () => {
  await BlockManager.stop();
  await stop();
});

// eslint-disable-next-line jest/no-disabled-tests
test.skip('should synchronize with the mainchain on bootup', async () => {
  // const bitKernel = await launchMiningBit();

  // @ts-ignore
  // config.mainchain.host = `127.0.0.1:${bitKernel.publicPort}`;
  await BlockManager.start();
  // @ts-ignore
  const [genesis] = await BlockManager.last4Blocks;
  expect(genesis.height).toBe(0);
  expect(genesis.isLongestChain).toBe(true);

  await MainDb.transaction(async client => {
    const transactions = await client.list<INoteRecord>('select * from notes');
    expect(transactions).toHaveLength(10);
    expect(
      transactions.filter(x => x.fromAddress === config.mainchain.addresses[0].bech32),
    ).toHaveLength(10);

    expect(
      transactions.filter(x => x.centagons === Constants.phase1FoundingMinerStableCentagons),
    ).toHaveLength(10);

    const transfersIn = await client.list<ISecurityRecord>('select * from securities');
    expect(transfersIn).toHaveLength(10);
    expect(
      transfersIn.filter(x => x.centagons === Constants.phase1FoundingMinerStableCentagons),
    ).toHaveLength(10);
  });
});

test('should keep the last 4 blocks in memory', async () => {
  await BlockManager.stop();
  const settingsSpy = jest.spyOn(MainchainClient.prototype, 'getBlockSettings');
  const blocksSpy = jest.spyOn(MainchainClient.prototype, 'getBlocks');
  await MainDb.transaction(client => {
    return client.batchInsert<IMainchainBlockRecord>('mainchain_blocks', [
      {
        height: 0,
        isLongestChain: true,
        nextLinkTarget: {
          powerOf2: 256,
        },
        prevBlockHash: null,
        blockHash: Buffer.from('1'),
      },
      {
        height: 1,
        nextLinkTarget: {
          powerOf2: 256,
        },
        isLongestChain: true,
        prevBlockHash: Buffer.from('1'),
        blockHash: Buffer.from('2'),
      },
      {
        height: 2,
        nextLinkTarget: {
          powerOf2: 256,
        },
        isLongestChain: true,
        prevBlockHash: Buffer.from('2'),
        blockHash: Buffer.from('3'),
      },
      {
        height: 3,
        nextLinkTarget: {
          powerOf2: 256,
        },
        isLongestChain: true,
        prevBlockHash: Buffer.from('3'),
        blockHash: Buffer.from('4'),
      },
    ]);
  });

  settingsSpy.mockImplementationOnce(async () => {
    return {
      blockHash: Buffer.from('5'),
      height: 4,
      nextLinkTarget: {
        powerOf2: 256,
      },
    } as any;
  });

  blocksSpy.mockImplementationOnce(async (blockHeights: number[], blockHashes: Buffer[]) => {
    expect(blockHashes[0]).toEqual(Buffer.from('5'));
    return {
      blocks: [
        {
          header: {
            height: 4,
            hash: Buffer.from('5'),
            prevBlockHash: Buffer.from('4'),
            nextLinkTarget: {
              powerOf2: 256,
            },
          },
          stableLedger: [],
        },
      ],
    } as { blocks: IBlock[] };
  });

  await BlockManager.start();

  expect(settingsSpy).toHaveBeenCalledTimes(1);
  expect(blocksSpy).toHaveBeenCalledTimes(1);

  // @ts-ignore
  const last4 = await BlockManager.last4Blocks;
  expect(last4[last4.length - 1].height).toBe(4);
  expect(last4[0].height).toBe(1);
  expect(last4).toHaveLength(4);
});

describe('block sync', () => {
  let blocksSpy;
  let sidechainFunds: Security;
  let transfer: Security;
  beforeAll(async () => {
    await BlockManager.stop();
    const settingsSpy = jest.spyOn(MainchainClient.prototype, 'getBlockSettings');
    blocksSpy = jest.spyOn(MainchainClient.prototype, 'getBlocks');

    settingsSpy.mockImplementationOnce(async () => {
      return {
        blockHash: Buffer.from('6'),
        height: 5,
        nextLinkTarget: {
          powerOf2: 256,
        },
      } as any;
    });

    const existingTxHash = sha3('should store an outbound hash');
    const transferHash = sha3('should store a transfer hash');

    // 1. establish securities
    await MainDb.transaction(async client => {
      // await client.update('TRUNCATE securities, notes CASCADE');

      await new Security(client, {
        centagons: 1234n,
        transactionHash: existingTxHash,
        transactionOutputIndex: 0,
        toAddress: userClient.address,
        fromAddress: mainchainAddress,
        transactionTime: new Date(),
        confirmedBlockHeight: 6,
        transactionOutputAddress: userClient.address,
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

      transfer = await new Security(client, {
        centagons: 100n,
        transactionHash: transferHash,
        transactionOutputIndex: 1,
        toAddress: userClient.address,
        fromAddress: mainchainAddress,
        transactionTime: new Date(),
        transactionOutputAddress: mainchainAddress,
        isToSidechain: false,
      }).save();
    });
  });

  test('should record block hashes onto outputs once transactions are committed to blocks', async () => {
    // now record to a "block" and make sure we update
    blocksSpy.mockImplementationOnce(async (blockHeights: number[], blockHashes: Buffer[]) => {
      expect(blockHashes[0]).toEqual(Buffer.from('6'));
      return {
        blocks: [
          {
            header: {
              height: 5,
              hash: Buffer.from('6'),
              prevBlockHash: Buffer.from('5'),
              nextLinkTarget: {
                powerOf2: 256,
              },
            },
            stableLedger: [
              {
                transactionHash: Buffer.from('should store'),
                type: TransactionType.TRANSFER,
                time: new Date(),
                sources: [
                  {
                    sourceAddressSigners: [
                      {
                        identity: '1234',
                      },
                      {
                        identity: '4321',
                      },
                    ],
                  },
                  {
                    sourceAddressSigners: [
                      {
                        identity: '22',
                      },
                      {
                        identity: '223',
                      },
                    ],
                  },
                ],
                outputs: [
                  {
                    address: mainchainAddress,
                    centagons: 112,
                    isSidechained: true,
                    addressOnSidechain: userSidechainClient.address,
                  },
                ],
              },
              {
                transactionHash: transfer.data.transactionHash,
                type: TransactionType.TRANSFER,
                time: new Date(),
                sources: [
                  {
                    sourceAddressSigners: [
                      {
                        identity:
                          config.mainchain.addressesByBech32[mainchainAddress].transferSigners[0]
                            .bech32,
                      },
                    ],
                  },
                ],
                outputs: [
                  {
                    address: userClient.address,
                    centagons: 100,
                  },
                  {
                    address: mainchainAddress,
                    centagons: 10000 - 100,
                    isSidechained: true,
                  },
                ],
              },
              {
                transactionHash: Buffer.from('should not store'),
                type: TransactionType.TRANSFER,
                time: new Date(),
                sources: [
                  {
                    sourceAddressSigners: [
                      {
                        identity: '12345',
                      },
                    ],
                    signatureSettings: {
                      count: 1,
                    },
                  },
                ],
                outputs: [
                  {
                    address: mainchainAddress,
                    centagons: 10000,
                    isBond: true,
                  },
                ],
              },
            ],
          },
        ],
      } as unknown as { blocks: IBlock[] };
    });

    await MainDb.transaction(async client => {
      await BlockManager.start();
      const transfersIn = await client.list<ISecurityRecord>(
        'select * from securities where from_address = $1',
        [userSidechainClient.address],
      );
      expect(transfersIn).toHaveLength(1);
      expect(transfersIn[0].centagons).toBe(112n);
      expect(transfersIn[0].noteHash).not.toBeTruthy();
      expect(transfersIn[0].confirmedBlockHeight).not.toBeTruthy();
      expect(transfersIn[0].transactionHash).toEqual(Buffer.from('should store'));

      // should update the block hashes for old transactions
      const blocks = await SecurityMainchainBlock.getRecordedBlocks(
        client,
        transfer.data.transactionHash,
      );
      expect(blocks).toHaveLength(1);
      expect(blocks[0].blockHash).toEqual(Buffer.from('6'));
      expect(blocks[0].blockStableLedgerIndex).toBe(1);
    });
  });

  test('should fill missing gaps', async () => {
    await BlockManager.stop();
    const settingsSpy = jest.spyOn(MainchainClient.prototype, 'getBlockSettings');
    settingsSpy.mockImplementationOnce(async () => {
      return {
        blockHash: Buffer.from('10'),
        height: 9,
        nextLinkTarget: {
          powerOf2: 256,
        },
      } as any;
    });

    // now record to a "block" and make sure we update
    blocksSpy.mockImplementation(async (blockHeights: number[], blockHashes: Buffer[]) => {
      if (blockHashes && blockHashes.length && blockHashes[0].equals(Buffer.from('10'))) {
        return {
          blocks: [
            {
              header: {
                height: 9,
                hash: Buffer.from('10'),
                prevBlockHash: Buffer.from('9'),
                nextLinkTarget: {
                  powerOf2: 256,
                },
              },
              stableLedger: [],
            },
          ],
        };
      }
      expect(blockHeights).toEqual([6, 7, 8]);
      return {
        blocks: [
          {
            header: {
              height: 6,
              hash: Buffer.from('7'),
              prevBlockHash: Buffer.from('6'),
              nextLinkTarget: {
                powerOf2: 256,
              },
            },
            stableLedger: [],
          },
          {
            header: {
              height: 7,
              hash: Buffer.from('8'),
              prevBlockHash: Buffer.from('7'),
              nextLinkTarget: {
                powerOf2: 256,
              },
            },
            stableLedger: [],
          },
          {
            header: {
              height: 8,
              hash: Buffer.from('9'),
              prevBlockHash: Buffer.from('8'),
              nextLinkTarget: {
                powerOf2: 256,
              },
            },
            stableLedger: [],
          },
        ],
      } as Required<{ blocks: IBlock[] }>;
    });

    await MainDb.transaction(async client => {
      await BlockManager.start();
      expect(settingsSpy).toBeCalled();
      const blocks = await client.list(
        'select * from mainchain_blocks where height in (6,7,8,9) and is_longest_chain=true',
      );
      expect(blocks).toHaveLength(4);
    });
  });
});
