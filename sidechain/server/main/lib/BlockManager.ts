import { createPromise } from '@ulixee/commons/lib/utils';
import Logger from '@ulixee/commons/lib/Logger';
import MainchainClient from '@ulixee/mainchain';
import {
  IBlock,
  IBlockHeader,
  IBlockSettings,
  ITransaction,
  TransactionType,
} from '@ulixee/specification';
import IArithmeticEncoding from '@ulixee/specification/types/IArithmeticEncoding';
import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';
import config from '../../config';
import RegisteredAddress from '../models/RegisteredAddress';
import MainchainBlock, { IMainchainBlockRecord } from '../models/MainchainBlock';
import Security from '../models/Security';
import MainDb from '../db';
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

  private static logger = log.createChild(module);

  private static settingsLoader = createPromise<IBlockSettings>();
  private static interval: NodeJS.Timer;
  private static last4Blocks: Promise<IMainchainBlockRecord[]>;
  private static isStopping = false;

  private static client: MainchainClient;

  public static async currentBlockHeight(): Promise<number> {
    return (await this.settings).height;
  }

  public static async currentBlockHash(): Promise<Buffer> {
    return (await this.settings).blockHash;
  }

  public static async getStableBlock(): Promise<IMainchainBlockRecord> {
    return await MainchainBlock.getStableChainRoot(config.mainchain.stableHeight);
  }

  public static async getBlocks(...hashes: Buffer[]): Promise<IBlock[]> {
    const { blocks } = await this.client.getBlocks([], hashes);
    return blocks;
  }

  public static async getBlockHeader(hash: Buffer): Promise<IMainchainBlockRecord> {
    const last4 = await this.last4Blocks;
    for (const block of last4) {
      if (block.blockHash.equals(hash)) {
        return block;
      }
    }

    const storedBlock = await MainchainBlock.getBlock(hash);
    if (storedBlock) {
      return storedBlock;
    }

    const { header } = await this.client.getBlockHeader(hash);
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
    if (!config.mainchain.host) {
      this.logger.warn('No mainchain configured. Setting block height to 0');
      this.settingsLoader.resolve({
        height: 0,
        minimumMicronoteBurnPercent: 20,
        sidechains: [{ rootIdentity: config.rootIdentity.bech32, url: config.baseUrl }],
      } as IBlockSettings);
      return;
    }

    this.client = new MainchainClient(config.mainchain.host);
    this.last4Blocks = MainchainBlock.getLatest4Blocks();
    await this.loadSettings();
    this.interval = setInterval(this.loadSettings, 2 * 60e3).unref();
  }

  public static stop(): void {
    this.client = null;
    this.isStopping = true;
    this.last4Blocks = null;
    this.settingsLoader = createPromise();
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private static findTransfersToSidechainWallet(transactions: ITransaction[]): {
    transfersIn: ITransferInSource[];
    transfersOut: ITransferRecorded[];
  } {
    const transfersIn: ITransferInSource[] = [];
    const transfersOut: ITransferRecorded[] = [];
    for (let i = 0; i < transactions.length; i += 1) {
      const transaction = transactions[i];
      if (
        transaction.type !== TransactionType.TRANSFER &&
        transaction.type !== TransactionType.COINBASE &&
        transaction.type !== TransactionType.COINAGE_CLAIM
      ) {
        continue;
      }

      const isFromSidechain = transaction.sources.find(x =>
        mainchainIdentities.has(x.sourceAddressSigners[0].identity),
      );

      if (isFromSidechain) {
        transfersOut.push({ transactionHash: transaction.transactionHash, index: i });
        continue;
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
    }
    return { transfersIn, transfersOut };
  }

  private static async saveFundingTransferIn(
    client: PgClient<DbType.Main>,
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
          const [prevBlock] = await this.getBlocks(block.header.prevBlockHash);
          await this.processNewLongestChainBlock(prevBlock);
        }
      }

      return await MainDb.transaction(
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

          const last4Blocks = await this.last4Blocks;
          if (!block.header.prevBlockHash) {
            if (!config.mainchain.acceptNewGenesisBlocks) {
              throw new Error('New genesis block proposed, but not accepting new genesis blocks');
            }

            // this is new longest!
            await client.query('update mainchain_blocks set is_longest_chain = false');
          } else if (!last4Blocks.some(x => x.blockHash.equals(block.header.prevBlockHash))) {
            await MainchainBlock.setLongestChain(client, block.header.prevBlockHash);
          }

          await latestBlock.save();

          const transfers = this.findTransfersToSidechainWallet(block.stableLedger);

          const inPromises = transfers.transfersIn.map(transfer =>
            this.saveFundingTransferIn(client, transfer, block.header),
          );
          await Promise.all(inPromises);

          const settings = await this.settings;
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
      this.logger.error(
        `Error saving new block: ${block.header.height} -> 0x${block.header.hash.toString('hex')}`,
        {
          error,
        },
      );
    }
  }

  private static async ensureBlockchainExists(latestBlock: IBlock): Promise<void> {
    const last4Blocks = await this.last4Blocks;
    if (latestBlock.header.height === 0) return;
    // make sure we have the last block
    if (!last4Blocks.some(x => x.blockHash.equals(latestBlock.header.prevBlockHash))) {
      // need to retrieve history
      const missingHeights = await MainchainBlock.getMissingHeights(
        latestBlock.header.height,
        latestBlock.header.prevBlockHash,
      );
      if (missingHeights.length) {
        const missingResponse = await this.client.getBlocks(missingHeights, []);
        const missingBlocks = missingResponse.blocks.filter(Boolean).sort((a, b) => {
          return a.header.height - b.header.height;
        });
        for (const block of missingBlocks) {
          await this.processNewLongestChainBlock(block);
        }
      }
    }
  }

  private static async loadSettings(): Promise<void> {
    const settings = await this.getBlockSettings();
    await MainDb.transaction(async client => {
      // lock so multi-server setups don't create conflicting batches
      await new RegisteredAddress(client, config.nullAddress).lock();

      this.last4Blocks = MainchainBlock.getLatest4Blocks();

      const last4Blocks = await this.last4Blocks;
      if (last4Blocks.some(x => x.blockHash.equals(settings.blockHash))) {
        return;
      }

      // TODO: if we have this block locally but it's > 4 back, we're going to provide invalid micronotes
      if (await MainchainBlock.getBlock(settings.blockHash)) {
        return;
      }

      // process missing block
      const { blocks } = await this.client.getBlocks([], [settings.blockHash]);

      const [latestBlock] = blocks;
      await this.ensureBlockchainExists(latestBlock);
      await this.processNewLongestChainBlock(latestBlock);
      this.last4Blocks = MainchainBlock.getLatest4Blocks();
    });
  }

  private static async getBlockSettings(): Promise<IBlockSettings> {
    if (this.settingsLoader.isResolved) {
      this.settingsLoader = createPromise<IBlockSettings>();
    }

    this.client
      .getBlockSettings()
      .then(this.settingsLoader.resolve)
      .catch(async error => {
        this.logger.warn('Mainchain client not available. Retrying in 10 seconds', { error });
        await new Promise(resolve => setTimeout(resolve, 10e3));
        if (!this.isStopping) {
          return await this.getBlockSettings();
        }
      });

    return await this.settings;
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
