import { ICoinage, LedgerType, TransactionError, TransactionType } from '@ulixee/specification';
import ITransaction from '@ulixee/specification/types/ITransaction';
import TypeSerializer from '@ulixee/commons/lib/TypeSerializer';
import Address from '@ulixee/crypto/lib/Address';
import buildBondPurchase from './builder/buildBondPurchase';
import buildSharesCoinageClaim from './builder/buildSharesCoinageClaim';
import buildTransfer from './builder/buildTransfer';
import IAddressTransfer from './interfaces/IAddressTransfer';
import CodedError from './lib/CodedError';
import TransactionBuilder from './lib/TransactionBuilder';
import UnspentOutput from './lib/UnspentOutput';
import AddressStore from './store/AddressStore';
import UnspentOutputStore from './store/UnspentOutputStore';
import IWalletApiService from './interfaces/IWalletApiService';

const enableDebugging = !!process.env.DEBUG;
function debug(message, data): void {
  if (enableDebugging) {
    // eslint-disable-next-line no-console
    console.debug(message, data);
  }
}

export default class Wallet {
  public unspentOutputStore: UnspentOutputStore;
  public addressStore: AddressStore;
  private currentBlockHeight: number;

  constructor(readonly apiService: IWalletApiService, readonly addresses: Address[]) {
    this.addressStore = new AddressStore(addresses);
    this.unspentOutputStore = new UnspentOutputStore();
  }

  public async getLatestBlockSettings(): Promise<void> {
    const settings = await this.apiService.getBlockSettings();
    this.currentBlockHeight = settings.height;
  }

  public async checkForBondRedemptions(): Promise<void> {
    for (const unspentBondOutput of this.unspentOutputStore.bonds) {
      const { transaction, blockHeight } = await this.apiService.checkForBondRedemption(
        unspentBondOutput.transaction.transactionHash,
      );
      if (blockHeight > this.currentBlockHeight) this.currentBlockHeight = blockHeight;
      if (transaction) {
        this.unspentOutputStore.recordBondRedemption(unspentBondOutput, transaction, blockHeight);
      }
    }
  }

  public async checkForTransactionConfirmations(): Promise<void> {
    for (const unspentOutput of this.unspentOutputStore.allUnspent) {
      if (unspentOutput.isConfirmed) {
        continue;
      }
      const { blockHash, blockHeight } = await this.apiService.findWithTransaction(
        unspentOutput.transaction.transactionHash,
        unspentOutput.sourceLedger,
      );
      if (Number.isNaN(blockHeight) || blockHeight === -1 || !blockHash) {
        continue;
      }
      if (blockHeight > this.currentBlockHeight) this.currentBlockHeight = blockHeight;
      this.unspentOutputStore.recordConfirmedBlock(unspentOutput, blockHeight, blockHash);
    }
  }

  public async claimSharesCoinage(coinages: ICoinage[]): Promise<ICoinageResult> {
    const { transaction, claims } = buildSharesCoinageClaim(
      this.unspentOutputStore,
      this.addressStore,
      coinages,
    );
    debug('SHARES COINAGE CLAIM %o', transaction);

    const response = await this.apiService.claimCoinage(transaction);

    if (response.error) {
      throw new CodedError(
        `ERROR creating coinage claim: ${TransactionError[response.error]}: ${response.message}`,
        response.error,
      );
    }

    const earned = this.unspentOutputStore.recordCoinageClaim(
      transaction,
      claims,
      response.preliminaryBlockHeight,
    );
    return {
      transaction,
      earnedUnspentOutput: earned,
      preliminaryBlockHeight: response.preliminaryBlockHeight,
    };
  }

  /**
   * Claim a grant coinage
   * @param coinage
   * @param centagonsToClaim
   * @param toAddress
   * @param addressOnSidechain - send straight to sidechain
   * @param dryRun - don't store and create claim
   */
  public async claimGrantCoinage(
    coinage: ICoinage,
    centagonsToClaim: number | bigint,
    toAddress?: string,
    addressOnSidechain?: string,
    dryRun = false,
  ): Promise<ICoinageResult> {
    if (centagonsToClaim < coinage.minimumClaimCentagons) {
      throw new CodedError(
        'Minimum coinage claim centagons not exceeded',
        TransactionError.COINAGE_CLAIM_MINIMUM_NOT_REACHED,
      );
    }

    centagonsToClaim = BigInt(centagonsToClaim);

    const builder = new TransactionBuilder(TransactionType.COINAGE_CLAIM, LedgerType.STABLE);

    builder.addOutput({
      address: toAddress || coinage.grantAddress,
      centagons: centagonsToClaim,
      addressOnSidechain,
    });

    const address = this.addressStore.getAddress(coinage.grantAddress);

    if (!address) {
      throw new CodedError(
        'Wallet address not loaded for this grant coinage',
        TransactionError.SOURCE_NOT_FOUND,
      );
    }

    builder.addSource(
      {
        blockClaimHeight: coinage.blockHeight,
        coinageHash: coinage.hash,
      },
      coinage.centagons,
      address,
    );

    const transaction = builder.finalize();
    debug('GRANT COINAGE CLAIM %o', TypeSerializer.replace(transaction));

    if (dryRun) {
      // eslint-disable-next-line no-console
      console.log('%o', TypeSerializer.replace(transaction));
      return;
    }

    const response = await this.apiService.claimCoinage(transaction);

    if (response.error) {
      throw new CodedError(
        `ERROR creating coinage claim: ${TransactionError[response.error]}: ${response.message}`,
        response.error,
      );
    }

    const earned = this.unspentOutputStore.recordCoinageClaim(
      transaction,
      [],
      response.preliminaryBlockHeight,
    );
    return {
      transaction,
      earnedUnspentOutput: earned,
      preliminaryBlockHeight: response.preliminaryBlockHeight,
    };
  }

  /**
   * Claim a bond. Will auto-calculate the discount price from the provided header
   */
  public async purchaseBonds(
    stableCentagonsToConvert: number | bigint,
    feeCentagons = 0n,
    expireAfterXBlocks?: number,
  ): Promise<ITransactionResult> {
    const { transaction, fromUnspentOutputs } = buildBondPurchase(
      this.unspentOutputStore,
      this.addressStore,
      this.currentBlockHeight,
      stableCentagonsToConvert,
      feeCentagons,
      expireAfterXBlocks,
    );

    debug('BOND PURCHASE %o', TypeSerializer.replace(transaction));
    const response = await this.apiService.purchase(transaction);

    if (response.error) {
      throw new Error(
        `ERROR creating bond purchase of ${stableCentagonsToConvert}: ${
          TransactionError[response.error]
        }: ${response.message}`,
      );
    }

    this.unspentOutputStore.recordBondPurchase(
      transaction,
      fromUnspentOutputs,
      response.preliminaryBlockHeight,
    );

    return {
      transaction,
      spent: fromUnspentOutputs,
      preliminaryBlockHeight: response.preliminaryBlockHeight,
    };
  }

  /**
   * Transfer X centagons to another user on a given ledger
   */
  public async transfer(
    ledgerType: LedgerType,
    transfers: IAddressTransfer[],
    feeCentagons = 0n,
  ): Promise<ITransfer> {
    let centagons = 0n;
    for (const entry of transfers) {
      centagons += entry.centagons;
    }

    const { fromUnspentOutputs } = this.unspentOutputStore.getUnspentOutputsCoveringBalance(
      ledgerType,
      centagons + feeCentagons,
    );
    return await this.transferUnspentOutputs(
      ledgerType,
      fromUnspentOutputs,
      transfers,
      feeCentagons,
    );
  }

  public async transferUnspentOutputs(
    ledgerType: LedgerType,
    fromUnspentOutputs: UnspentOutput[],
    transfers: IAddressTransfer[],
    feeCentagons = 0n,
  ): Promise<ITransfer> {
    const transaction = buildTransfer(
      fromUnspentOutputs,
      this.addressStore,
      transfers,
      feeCentagons,
    );
    debug('TRANSFER %o', TypeSerializer.replace(transaction));

    const response = await this.apiService.transfer(ledgerType, transaction);

    if (response.error) {
      throw new CodedError(
        `ERROR creating transaction sending ${transaction.outputs[0].centagons} to ${transfers
          .map(x => x.toAddress)
          .join(',')}: ${TransactionError[response.error]}: ${response.message}`,
        response.error,
      );
    }

    const { changeOutput, transferred } = this.unspentOutputStore.recordTransfer(
      transaction,
      ledgerType,
      fromUnspentOutputs,
      this.addressStore.changeAddress,
      response.preliminaryBlockHeight,
    );

    return {
      transaction,
      transferred,
      change: changeOutput,
      spent: fromUnspentOutputs,
      preliminaryBlockHeight: response.preliminaryBlockHeight,
    };
  }
}

interface ICoinageResult {
  transaction: ITransaction;
  earnedUnspentOutput: UnspentOutput;
  preliminaryBlockHeight: number;
}

interface ITransactionResult {
  transaction: ITransaction;
  spent: UnspentOutput[];
  preliminaryBlockHeight: number;
}

interface ITransfer extends ITransactionResult {
  transferred: UnspentOutput[];
  change: UnspentOutput;
}
