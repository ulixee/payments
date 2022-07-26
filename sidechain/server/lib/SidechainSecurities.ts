import { sha3 } from '@ulixee/commons/lib/hashUtils';
import Log from '@ulixee/commons/lib/Logger';
import { ITransaction, IWalletSignature } from '@ulixee/specification';
import KeyringSignature from '@ulixee/crypto/lib/KeyringSignature';
import Keyring from '@ulixee/crypto/lib/Keyring';
import config from '../config';
import FundingTransferOut from '../models/FundingTransferOut';
import MainchainBlock, { IMainchainBlockRecord } from '../models/MainchainBlock';
import MainchainTransaction from '../models/MainchainTransaction';
import MicronoteBatchOutput, { IMicronoteBatchOutputRecord } from '../models/MicronoteBatchOutput';
import Security, { ISecurityRecord } from '../models/Security';
import PgClient from './PgClient';
import { DbType } from './PgPool';
import buildTransactionTransferOut from './buildTransactionTransferOut';
import { OutOfBalanceError } from './errors';
import SecurityMainchainBlock from '../models/SecurityMainchainBlock';

const { log } = Log(module);

const mainchainWalletsByAddress: { [sidechainKeysHash: string]: Keyring } = {};
for (const wallet of config.mainchain.wallets) {
  mainchainWalletsByAddress[wallet.address] = wallet;
}

export default class SidechainSecurities {
  constructor(
    readonly client: PgClient<DbType.Default>,
    readonly prevBlockHeader: IMainchainBlockRecord,
  ) {}

  public async createBlockOutput(): Promise<IBlockSecurityOutput> {
    const { centagonsToBurn, unburnedBatchOutputs } = await MicronoteBatchOutput.findUnburned(
      this.client,
    );

    const securitiesNotOnChain = await this.findOutboundSecuritiesNotOnChain();

    const burnTransactions = await this.burnSecurities(centagonsToBurn, unburnedBatchOutputs);

    const transfers = await this.buildFundingTransfersOut();

    const { transfersOut } = transfers;

    // add missing elements for this fork
    unburnedBatchOutputs.push(...securitiesNotOnChain.batchOutputs);
    burnTransactions.push(...securitiesNotOnChain.burnTransactions);
    transfersOut.push(...securitiesNotOnChain.transfersOut);

    let totalTransfersOut = transfers.transferCentagons;
    for (const transfer of securitiesNotOnChain.transfersOut) {
      for (const output of transfer.outputs) {
        if (!mainchainWalletsByAddress[output.address]) {
          totalTransfersOut += output.centagons;
        }
      }
    }

    const { sidechainFunds, addressProofs } = await this.getSecuritiesProof(
      this.prevBlockHeader.blockHash,
    );
    return {
      unburnedBatchOutputs,
      sidechainFunds,
      burnTransactions,
      transfersOut,
      addressProofs,
      transferCentagons: totalTransfersOut,
    };
  }

  private async getSecuritiesProof(prevBlockHash: Buffer): Promise<ISecuritiesProof> {
    const unspentFunds = await Security.allUnspentFunds(this.client);
    const hashable = sha3(prevBlockHash);
    const addresses = new Set<string>();
    const sidechainFunds: ISidechainOwnedSecurity[] = unspentFunds.map(security => {
      addresses.add(security.transactionOutputAddress);
      return {
        transactionHash: security.transactionHash,
        outputIndex: security.transactionOutputIndex,
        centagons: security.centagons,
      };
    });

    const addressProofs: IAddressOwnershipProof[] = [];
    for (const address of addresses.values()) {
      const wallet = mainchainWalletsByAddress[address];
      const signatures = KeyringSignature.create(
        hashable,
        wallet.claimKeys,
        wallet.keyringMerkleTree,
        wallet.keyringSettings,
        true,
      );
      addressProofs.push({
        address,
        signers: signatures.signers,
        signatureSettings: signatures.signatureSettings,
      });
    }
    return { sidechainFunds, addressProofs };
  }

  private async burnSecurities(
    centagonsToBurn: bigint,
    unburnedBatchOutputs: IMicronoteBatchOutputRecord[],
  ): Promise<ITransaction[]> {
    if (centagonsToBurn === 0n) {
      return [];
    }
    const { transaction } = await buildTransactionTransferOut(
      this.client,
      [
        {
          centagons: centagonsToBurn,
          address: config.nullAddress,
        },
      ],
      true,
    );

    for (const batch of unburnedBatchOutputs) {
      const micronoteBatch = new MicronoteBatchOutput(this.client, batch);
      await micronoteBatch.recordBurnSecurity(this.client, transaction.transactionHash);
    }

    return [transaction];
  }

  private async buildFundingTransfersOut(): Promise<IFundingTransfersOut> {
    const pendingTransfersOut = await FundingTransferOut.findPendingTransfers(this.client);

    if (!pendingTransfersOut.length) {
      return {
        transfersOut: [],
        transferCentagons: 0n,
      };
    }

    // build transaction from unspent outputs
    const { transaction } = await buildTransactionTransferOut(
      this.client,
      pendingTransfersOut.map(x => ({
        centagons: x.centagons,
        address: x.fromAddress,
        noteHash: x.noteHash,
      })),
    );

    await FundingTransferOut.recordTransaction(
      this.client,
      transaction.transactionHash,
      pendingTransfersOut,
    );

    return {
      transfersOut: [transaction],
      transferCentagons: pendingTransfersOut.reduce((total, entry) => total + entry.centagons, 0n),
    };
  }

  private async findOutboundSecuritiesNotOnChain(): Promise<{
    securities: ISecurityRecord[];
    burnTransactions: ITransaction[];
    transfersOut: ITransaction[];
    batchOutputs: IMicronoteBatchOutputRecord[];
  }> {
    const blockchain = await MainchainBlock.getBlockchain(
      this.client,
      this.prevBlockHeader.blockHash,
      25,
    );
    const batchOutputs: MicronoteBatchOutput[] = [];
    const burnTransactions: ITransaction[] = [];
    const transfersOut: ITransaction[] = [];

    const securities = await SecurityMainchainBlock.findSecuritiesNotInChain(
      this.client,
      blockchain.map(x => x.blockHash),
    );

    for (const security of securities || []) {
      const transaction = await MainchainTransaction.getTransaction(
        this.client,
        security.transactionHash,
      );
      if (security.isBurn) {
        // find micronote batches
        const batches = await MicronoteBatchOutput.findWithSecurity(
          this.client,
          security.transactionHash,
        );
        batchOutputs.push(...batches);
        burnTransactions.push(transaction);
      } else {
        transfersOut.push(transaction);
      }
    }
    return {
      securities,
      burnTransactions,
      transfersOut,
      batchOutputs: batchOutputs.map(x => x.data),
    };
  }

  public static ensureZeroBalance(
    walletBalances: IWalletBalance[],
    burnBalance: bigint,
    transferOutCentagons: bigint,
    sidechainFundingIn: bigint,
    sidechainSecurityFunds: ICentagon[],
  ): void {
    // wallet balances need to add to 0
    let totalWalletsBalance = 0n;
    let securitiesBalance = 0n;

    // now add up wallet balances
    for (const balance of walletBalances) {
      totalWalletsBalance += balance.centagons;
    }

    for (const fund of sidechainSecurityFunds) {
      securitiesBalance += fund.centagons;
    }

    // 1. <all wallets> + <burn> - <sidechain wallets> === 0 (sidechain wallets have negative amounts since funds "appear" in the ledger without a source)
    // 2. <all wallets> === <funding>
    if (
      totalWalletsBalance - sidechainFundingIn + burnBalance !== 0n ||
      totalWalletsBalance !== securitiesBalance
    ) {
      log.warn('SidechainSecurities.OutOfBalance', {
        totalWalletsBalance,
        fundsBalance: securitiesBalance,
        fundsMinusBurn: totalWalletsBalance - sidechainFundingIn + burnBalance,
        burnBalance,
        sidechainFundingInCentagons: sidechainFundingIn,
        sessionId: null,
      });
      throw new OutOfBalanceError(totalWalletsBalance.toString(), securitiesBalance.toString());
    }
  }
}

interface IWalletBalance {
  address: string;
  centagons: bigint;
}

interface ICentagon {
  centagons: bigint;
}

interface ISidechainOwnedSecurity {
  centagons: bigint;
  outputIndex: number;
  transactionHash: Buffer;
}

interface IAddressOwnershipProof extends IWalletSignature {
  address: string;
}

interface ISecuritiesProof {
  addressProofs: IAddressOwnershipProof[];
  sidechainFunds: ISidechainOwnedSecurity[];
}

interface IFundingTransfersOut {
  transfersOut: ITransaction[];
  transferCentagons: bigint;
}

interface IBlockSecurityOutput extends ISecuritiesProof {
  unburnedBatchOutputs: IMicronoteBatchOutputRecord[];
  burnTransactions: ITransaction[];
  transfersOut: ITransaction[];
  transferCentagons: bigint;
}
