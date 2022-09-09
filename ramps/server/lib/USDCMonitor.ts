import Logger from '@ulixee/commons/lib/Logger';
import { NoteType } from '@ulixee/specification';
import SidechainClient from '@ulixee/sidechain/lib/SidechainClient';
import Address from '@ulixee/crypto/lib/Address';
import { InsufficientFundsError } from '@ulixee/payment-utils/lib/errors';
import USDCAddress, { IUSDCAddress } from '../models/USDCAddress';
import USDCApi from './USDCApi';
import config from '../config';
import USDCTransfer, { IUSDCTransfer } from '../models/USDCTransfer';
import RampApp from './RampApp';
import { Confirmations, IBlockchain } from './USDCNetworks';
import RampLock from '../models/RampLock';
import RampAudit from '../models/RampAudit';
import ConsumerPriceIndex from '../models/ConsumerPriceIndex';

const { log } = Logger(module);

export default class USDCMonitor {
  public static sidechainClient: SidechainClient;
  private static interval: NodeJS.Timer;
  private static confirmationsLockId = 'usdc-monitor-confirmations';
  private static transfersLockId = 'usdc-monitor-transfers';
  private static isStopping = false;
  private static isStartingPromise: Promise<void>;
  private static logger = log.createChild(module);

  public static start(): Promise<void> {
    if (this.isStartingPromise) return this.isStartingPromise;
    this.isStartingPromise = this.startInternal();
  }

  public static stop(): Promise<void> {
    this.isStopping = true;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    return Promise.resolve();
  }

  protected static async startInternal(): Promise<void> {
    this.sidechainClient = new SidechainClient(config.sidechainHost, {});
    this.interval = setInterval(() => this.runInterval(), 2 * 60e3).unref();
    await RampApp.db.transaction(async db => {
      await RampLock.create(db, this.confirmationsLockId);
      await RampLock.create(db, this.transfersLockId);
    });
    await this.runInterval();
  }

  protected static async runInterval(): Promise<void> {
    const opts = { logger: this.logger };
    await RampApp.db.transaction(async client => {
      await RampLock.lock(client, this.transfersLockId);
      await this.checkTransfers();
    }, opts);

    await RampApp.db.transaction(async client => {
      await RampLock.lock(client, this.confirmationsLockId);
      await this.checkConfirmations();
    }, opts);
  }

  private static async checkConfirmations(): Promise<void> {
    const unconfirmedTransfers = await USDCTransfer.findUnconfirmed();
    if (!unconfirmedTransfers.length) return;

    // group addresses by network
    const transfersByNetwork: { [network: string]: IUSDCTransfer[] } = {};
    for (const transfer of unconfirmedTransfers) {
      transfersByNetwork[transfer.blockchainNetwork] ??= [];
      transfersByNetwork[transfer.blockchainNetwork].push(transfer);
    }

    for (const transfers of Object.values(transfersByNetwork)) {
      const [{ blockchain, blockchainNetwork }] = transfers;
      const api = new USDCApi(blockchain, blockchainNetwork);
      const latestBlockNumber = await api.currentBlockNumber();
      // check 10 confirmations for ethereum, 128 for polygon
      const minConfirmations = Confirmations[blockchain];
      const minConfirmationBlockNumber = latestBlockNumber - minConfirmations;
      for (const transfer of transfers) {
        if (latestBlockNumber - transfer.blockNumber >= minConfirmationBlockNumber) {
          const confirmationBlock = await api.getConfirmations(transfer.transactionHash);
          if (confirmationBlock.confirmations >= minConfirmations) {
            await this.convertUSDCToArgons(transfer, confirmationBlock);
          }
        }
      }
    }
  }

  private static async convertUSDCToArgons(
    transfer: IUSDCTransfer,
    confirmationBlock: {
      blockNumber: number;
      blockHash: string;
      confirmations: number;
    },
  ): Promise<void> {
    const opts = { logger: this.logger };
    await RampApp.db.transaction(async client => {
      const usdcAddress = await USDCAddress.loadById(client, transfer.toUsdcAddressId);
      const latestAudit = await RampAudit.latestSignedAudit(client);

      const centagons = USDCTransfer.convertDollarsToCentagons(
        Number(transfer.usdc),
        transfer.argonConversionRate,
        latestAudit?.usdcReservesE6,
        latestAudit?.argonsInCirculationE6,
      );

      const addresses = config.sidechainAddressesForReserves;
      let address: Address = null;
      for (const reserveAddress of addresses) {
        const balance = await this.sidechainClient.getBalance(reserveAddress.bech32);
        if (balance >= centagons) {
          address = reserveAddress;
          break;
        }
      }

      if (!address) {
        throw new InsufficientFundsError(
          'This Sidechain does not have any loaded Reserves accounts that can afford to sell to a USDC buyer',
          centagons.toString(),
        );
      }

      const note = await SidechainClient.buildNote(
        address,
        centagons,
        usdcAddress.sidechainAddress,
        NoteType.transfer,
      );
      await USDCTransfer.recordConfirmation(client, transfer, confirmationBlock, note.noteHash);

      log.info('Transferring reserves', {
        noteHash: note.noteHash,
        centagons,
        transfer,
        usdcConfirmation: confirmationBlock,
      } as any);
      await this.sidechainClient.runRemote('Note.create', { note });
    }, opts);
  }

  private static async checkTransfers(): Promise<IUSDCTransfer[]> {
    const openAddresses = await USDCAddress.findOpenAddresses({ logger: this.logger });
    if (!openAddresses.length) return;

    // group addresses by network
    const addressesByNetwork: {
      [blockchainNetwork: string]: {
        blockchain: IBlockchain;
        byLastCheckedBlockNumber: { [blockNumber: number]: string[] };
        byAddress: { [usdcAddress: string]: IUSDCAddress };
      };
    } = {};

    for (const open of openAddresses) {
      addressesByNetwork[open.blockchainNetwork] ??= {
        blockchain: open.blockchain,
        byLastCheckedBlockNumber: {},
        byAddress: {},
      };
      const entry = addressesByNetwork[open.blockchainNetwork];
      entry.byLastCheckedBlockNumber[open.lastCheckedBlockNumber] ??= [];
      entry.byLastCheckedBlockNumber[open.lastCheckedBlockNumber].push(open.usdcAddress);
      entry.byAddress[open.usdcAddress] = open;
    }

    const usdcTransfers: IUSDCTransfer[] = [];
    for (const [
      blockchainNetwork,
      { blockchain, byAddress, byLastCheckedBlockNumber },
    ] of Object.entries(addressesByNetwork)) {
      const api = new USDCApi(blockchain, blockchainNetwork);

      for (const [lastCheckedBlockNumber, usdcAddresses] of Object.entries(
        byLastCheckedBlockNumber,
      )) {
        const latestBlockNumber = await api.currentBlockNumber();
        const transfers = await api.findTransfersToAddresses(
          usdcAddresses,
          Number(lastCheckedBlockNumber),
        );
        const latestCpi = await ConsumerPriceIndex.getLatest();
        const conversionRate = latestCpi.conversionRate;

        await RampApp.db.transaction(async client => {
          for (const transfer of transfers) {
            const addressId = byAddress[transfer.toAddress].id;
            const result = await USDCTransfer.onTransferFound(
              client,
              transfer,
              blockchain,
              blockchainNetwork,
              addressId,
              conversionRate,
            );
            usdcTransfers.push(result);
          }
          // record latest seen
          await client.update(
            `update ${USDCAddress.table} set last_checked_block_number = $1 where usdc_address = ANY ($2)`,
            [latestBlockNumber, usdcAddresses],
          );
        });
      }
    }
    return usdcTransfers;
  }
}
