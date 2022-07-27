import IArithmeticEncoding from '@ulixee/block-utils/interfaces/IArithmeticEncoding';
import { createPromise } from '@ulixee/commons/lib/utils';
import IBlockSettings from '@ulixee/block-utils/interfaces/IBlockSettings';
import Logger from '@ulixee/commons/lib/Logger';
import MainchainClient from '@ulixee/mainchain-client';
import { IBlock, IBlockHeader, ITransaction, TransactionType } from '@ulixee/specification';
import config from '../config';
import Wallet from '../models/Wallet';
import MainchainBlock, { IMainchainBlockRecord } from '../models/MainchainBlock';
import Security from '../models/Security';
import db from './defaultDb';
import PgClient from './PgClient';
import { DbType } from './PgPool';
import SecurityMainchainBlock from '../models/SecurityMainchainBlock';

const { log } = Logger(module);

const mainchainIdentities = new Set<string>();
for (const wallet of config.mainchain.addresses) {
  for (const identity of [...wallet.transferSigners, ...wallet.claimSigners]) {
    mainchainIdentities.add(identity.bech32);
  }
}

export default class BlockManager {
  public static get settings(): Promise<IBlockSettings> {
    return this.settingsLoader.promise;
  }

  private static logger = log.createChild(module, {
    action: 'BlockManager.processNewLongestChainBlock',
  });

  private static settingsLoader = createPromise<IBlockSettings>();
  private static interval: NodeJS.Timer;
  private static last4Blocks: Promise<IMainchainBlockRecord[]>;
  private static isStopping = false;

  private static client: MainchainClient;

  public static async currentBlockHeight(): Promise<number> {
    return (await BlockManager.settings).height;
  }

  public static async currentBlockHash(): Promise<Buffer> {
    return (await BlockManager.settings).blockHash;
  }

  public static async getStableBlock(): Promise<IMainchainBlockRecord> {
    return await MainchainBlock.getStableChainRoot(config.mainchain.stableHeight);
  }

  public static async getBlocks(...hashes: Buffer[]): Promise<IBlock[]> {
    const { blocks } = await BlockManager.client.getBlocks([], hashes);
    return blocks;
  }

  public static async getBlockHeader(hash: Buffer): Promise<IMainchainBlockRecord> {
    const last4 = await BlockManager.last4Blocks;
    for (const block of last4) {
      if (block.blockHash.equals(hash)) {
        return block;
      }
    }

    const storedBlock = await MainchainBlock.getBlock(hash);
    if (storedBlock) {
      return storedBlock;
    }

    const { header } = await BlockManager.client.getBlockHeader(hash);
    if (header) {
      return {
        nextLinkTarget: header.nextLinkTarget as IArithmeticEncoding,
        height: header.height,
        blockHash: hash,
        prevBlockHash: header.prevBlockHash,
      } as IMainchainBlockRecord;
    }
    return null;
  }

  public static async start(): Promise<void> {
    BlockManager.client = new MainchainClient(config.mainchain.host);
    BlockManager.last4Blocks = MainchainBlock.getLatest4Blocks();
    await BlockManager.loadSettings();
    BlockManager.interval = setInterval(BlockManager.loadSettings, 2 * 60e3).unref();
  }

  public static stop(): void {
    BlockManager.isStopping = true;
    if (BlockManager.interval) {
      clearInterval(BlockManager.interval);
      BlockManager.interval = null;
    }
  }

  private static findTransfersToSidechainWallet(transactions: ITransaction[]): {
    transfersIn: ITransferInSource[];
    transfersOut: ITransferRecorded[];
  } {
    const transfersIn: ITransferInSource[] = [];
    const transfersOut: ITransferRecorded[] = [];
    transactions.forEach((transaction, i) => {
      if (
        transaction.type !== TransactionType.TRANSFER &&
        transaction.type !== TransactionType.COINBASE &&
        transaction.type !== TransactionType.COINAGE_CLAIM
      ) {
        return;
      }

      const isFromSidechain = transaction.sources.find(x =>
        mainchainIdentities.has(x.sourceAddressSigners[0].identity),
      );

      if (isFromSidechain) {
        transfersOut.push({ transactionHash: transaction.transactionHash, index: i });
        return;
      }

      transaction.outputs.forEach((output, outputIndex) => {
        if (output.isSidechained !== true) {
          return;
        }

        const sidechainWallet = config.mainchain.addressesByBech32[output.address];
        if (!sidechainWallet) {
          return;
        }

        transfersIn.push({
          transactionHash: transaction.transactionHash,
          transactionTime: transaction.time,
          blockStableLedgerIndex: i,
          centagons: output.centagons,
          fromAddress: output.addressOnSidechain,
          toAddress: sidechainWallet.bech32,
          transactionOutputAddress: output.address,
          transactionOutputIndex: outputIndex,
        });
      });
    });
    return { transfersIn, transfersOut };
  }

  private static async saveFundingTransferIn(
    client: PgClient<DbType.Default>,
    transferDetails: ITransferInSource,
    blockHeader: IBlockHeader,
  ): Promise<void> {
    await new Security(client, {
      transactionHash: transferDetails.transactionHash,
      transactionOutputIndex: transferDetails.transactionOutputIndex,
      transactionOutputAddress: transferDetails.transactionOutputAddress,
      transactionTime: transferDetails.transactionTime,
      centagons: transferDetails.centagons,
      isToSidechain: true,
      isTransferIn: true,
      toAddress: transferDetails.toAddress,
      fromAddress: transferDetails.fromAddress,
      isBurn: false,
    }).save({
      blockStableLedgerIndex: transferDetails.blockStableLedgerIndex,
      blockHash: blockHeader.hash,
      blockHeight: blockHeader.height,
    });
  }

  private static async processNewLongestChainBlock(block: IBlock): Promise<MainchainBlock> {
    try {
      if (block.header.prevBlockHash) {
        // make sure we have the last block before starting a transaction
        const prev = await MainchainBlock.getBlock(block.header.prevBlockHash);
        if (!prev) {
          const [prevBlock] = await BlockManager.getBlocks(block.header.prevBlockHash);
          await this.processNewLongestChainBlock(prevBlock);
        }
      }

      return await db.transaction(
        async client => {
          const latestBlock = new MainchainBlock(client, {
            blockHash: block.header.hash,
            height: block.header.height,
            nextLinkTarget: block.header.nextLinkTarget as IArithmeticEncoding,
            prevBlockHash: block.header.prevBlockHash,
            isLongestChain: true,
          });

          // first lock the block before updating
          await latestBlock.lockForCreate();

          const last4Blocks = await BlockManager.last4Blocks;
          if (!last4Blocks.some(x => x.blockHash.equals(block.header.prevBlockHash))) {
            await MainchainBlock.setLongestChain(client, block.header.prevBlockHash);
          }

          await latestBlock.save();

          const transfers = BlockManager.findTransfersToSidechainWallet(block.stableLedger);

          const inPromises = transfers.transfersIn.map(transfer =>
            BlockManager.saveFundingTransferIn(client, transfer, block.header),
          );
          await Promise.all(inPromises);

          const settings = await BlockManager.settings;
          await Security.recordConfirmedSecurities(client, settings.height);

          const outPromises = transfers.transfersOut.map(transfer =>
            SecurityMainchainBlock.record(client, {
              transactionHash: transfer.transactionHash,
              blockHash: block.header.hash,
              blockHeight: block.header.height,
              blockStableLedgerIndex: transfer.index,
            }),
          );
          await Promise.all(outPromises);

          return latestBlock;
        },
        { logger: this.logger },
      );
    } catch (error) {
      this.logger.error(`Error saving new block: ${block.header.height} -> ${block.header.hash}`, {
        error,
      });
    }
  }

  private static async ensureBlockchainExists(latestBlock: IBlock): Promise<void> {
    const last4Blocks = await BlockManager.last4Blocks;
    if (latestBlock.header.height === 0) return;
    // make sure we have the last block
    if (!last4Blocks.some(x => x.blockHash.equals(latestBlock.header.prevBlockHash))) {
      // need to retrieve history
      const missingHeights = await MainchainBlock.getMissingHeights(
        latestBlock.header.height,
        latestBlock.header.prevBlockHash,
      );
      if (missingHeights.length) {
        const missingResponse = await BlockManager.client.getBlocks(missingHeights, []);
        const missingBlocks = missingResponse.blocks.filter(Boolean).sort((a, b) => {
          return a.header.height - b.header.height;
        });
        for (const block of missingBlocks) {
          await BlockManager.processNewLongestChainBlock(block);
        }
      }
    }
  }

  private static async loadSettings(): Promise<void> {
    const settings = await BlockManager.getBlockSettings();
    await db.transaction(async client => {
      // lock so multi-server setups don't create conflicting batches
      await new Wallet(client, config.nullAddress).lock();

      BlockManager.last4Blocks = MainchainBlock.getLatest4Blocks();

      const last4Blocks = await BlockManager.last4Blocks;
      if (last4Blocks.some(x => x.blockHash.equals(settings.blockHash))) {
        return;
      }

      // TODO: if we have this block locally but it's > 4 back, we're going to provide invalid micronotes
      if (await MainchainBlock.getBlock(settings.blockHash)) {
        return;
      }

      // process missing block
      const { blocks } = await BlockManager.client.getBlocks([], [settings.blockHash]);

      const [latestBlock] = blocks;
      await BlockManager.ensureBlockchainExists(latestBlock);
      await BlockManager.processNewLongestChainBlock(latestBlock);
      BlockManager.last4Blocks = MainchainBlock.getLatest4Blocks();
    });
  }

  private static async getBlockSettings(): Promise<IBlockSettings> {
    if (BlockManager.settingsLoader.isResolved) {
      BlockManager.settingsLoader = createPromise<IBlockSettings>();
    }

    BlockManager.client
      .getBlockSettings()
      .then(settings => {
        return BlockManager.settingsLoader.resolve({
          ...settings,
          isSidechainApproved: identity =>
            Promise.resolve(settings.sidechains.some(x => x.rootIdentity === identity)),
        } as IBlockSettings);
      })
      .catch(async error => {
        this.logger.warn('Mainchain client not available.  Retrying in 10 seconds', { error });
        await new Promise(resolve => setTimeout(resolve, 10e3));
        if (!BlockManager.isStopping) {
          return await BlockManager.getBlockSettings();
        }
      });

    return await BlockManager.settings;
  }
}

interface ITransferRecorded {
  transactionHash: Buffer;
  index: number;
}

interface ITransferInSource {
  transactionHash: Buffer;
  transactionOutputIndex: number;
  transactionOutputAddress: string;
  centagons: bigint;
  fromAddress: string;
  toAddress: string;
  blockStableLedgerIndex: number;
  transactionTime: Date;
}
