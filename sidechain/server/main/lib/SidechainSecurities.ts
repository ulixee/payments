import { sha3 } from '@ulixee/commons/lib/hashUtils';
import Log from '@ulixee/commons/lib/Logger';
import { IAddressSignature, ITransaction } from '@ulixee/specification';
import AddressSignature from '@ulixee/crypto/lib/AddressSignature';
import config from '../../config';
import FundingTransferOut from '../models/FundingTransferOut';
import MainchainBlock, { IMainchainBlockRecord } from '../models/MainchainBlock';
import MainchainTransaction from '../models/MainchainTransaction';
import MicronoteBatchOutput, { IMicronoteBatchOutputRecord } from '../models/MicronoteBatchOutput';
import Security, { ISecurityRecord } from '../models/Security';
import PgClient from '../../utils/PgClient';
import { DbType } from '../../utils/PgPool';
import buildTransactionTransferOut from './buildTransactionTransferOut';
import { OutOfBalanceError } from '../../utils/errors';
import SecurityMainchainBlock from '../models/SecurityMainchainBlock';

const { log } = Log(module);

export default class SidechainSecurities {
  constructor(
    readonly client: PgClient<DbType.Main>,
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
        if (!config.mainchain.addressesByBech32[output.address]) {
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
      const wallet = config.mainchain.addressesByBech32[address];
      const signatures = AddressSignature.create(
        hashable,
        wallet.claimSigners,
        wallet.ownersMerkleTree,
        wallet.addressSettings,
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
    let totalAddressesBalance = 0n;
    let securitiesBalance = 0n;

    // now add up wallet balances
    for (const balance of walletBalances) {
      totalAddressesBalance += balance.centagons;
    }

    for (const fund of sidechainSecurityFunds) {
      securitiesBalance += fund.centagons;
    }

    // 1. <all addresses> + <burn> - <sidechain addresses> === 0 (sidechain addresses negative amounts since funds "appear" in the ledger without a source)
    // 2. <all addresses> === <funding>
    if (
      totalAddressesBalance - sidechainFundingIn + burnBalance !== 0n ||
      totalAddressesBalance !== securitiesBalance
    ) {
      log.warn('SidechainSecurities.OutOfBalance', {
        totalAddressesBalance,
        fundsBalance: securitiesBalance,
        fundsMinusBurn: totalAddressesBalance - sidechainFundingIn + burnBalance,
        burnBalance,
        sidechainFundingInCentagons: sidechainFundingIn,
        sessionId: null,
      });
      throw new OutOfBalanceError(totalAddressesBalance.toString(), securitiesBalance.toString());
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

interface IAddressOwnershipProof extends IAddressSignature {
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
