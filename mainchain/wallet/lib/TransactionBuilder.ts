import { hashObject } from '@ulixee/commons/lib/hashUtils';
import {
  ITransaction,
  ITransactionOutput,
  ITransactionSource,
  LedgerType,
  TransactionError,
  TransactionType,
} from '@ulixee/specification';
import Keyring from '@ulixee/crypto/lib/Keyring';
import KeyringSignature from '@ulixee/crypto/lib/KeyringSignature';
import buildTransactionSourceHash from './buildTransactionSourceHash';
import CodedError from './CodedError';

export default class TransactionBuilder {
  public readonly transaction: ITransaction;
  private readonly sources: ISource[] = [];

  constructor(
    readonly type: TransactionType,
    readonly ledger: LedgerType,
    readonly expiresAtBlockHeight?: number,
  ) {
    const tx = {} as ITransaction;
    tx.version = '1';
    tx.type = type;
    tx.time = new Date();
    tx.expiresAtBlockHeight = expiresAtBlockHeight;
    tx.outputs = [];
    tx.sources = [];
    this.transaction = tx;
  }

  public addOutput(output: ITransactionOutput): TransactionBuilder {
    this.transaction.outputs.push({
      centagons: output.centagons,
      address: output.address,
      isBond: output.isBond,
      isBurned: output.isBurned,
      addressOnSidechain: output.addressOnSidechain,
      isSidechained: !!output.addressOnSidechain || output.isSidechained,
    });
    return this;
  }

  public addSource(
    source: Partial<ITransactionSource>,
    centagons: bigint,
    wallet: Keyring,
  ): TransactionBuilder {
    if (!wallet) {
      throw new CodedError('No wallet specified for source', TransactionError.INVALID_SOURCES);
    }
    this.sources.push({ wallet, source, centagons });
    return this;
  }

  public finalize(): ITransaction {
    const isClaim = this.type === TransactionType.COINAGE_CLAIM;

    for (const uxto of this.sources) {
      const { source, wallet, centagons } = uxto;
      const settings = wallet.keyringSettings;
      const merkle = wallet.keyringMerkleTree;
      const keypairs = isClaim ? wallet.claimKeys : wallet.transferKeys;
      source.sourceWalletSignatureSettings = KeyringSignature.buildSignatureSettings(
        merkle,
        settings,
        isClaim,
      );

      const uxtoSourceHash = buildTransactionSourceHash(
        this.transaction,
        source as any,
        this.ledger,
        {
          centagons,
          address: wallet.address,
        },
      );

      const walletSignature = KeyringSignature.create(
        uxtoSourceHash,
        keypairs,
        merkle,
        settings,
        isClaim,
      );

      this.transaction.sources.push({
        sourceWalletSignatureSettings: source.sourceWalletSignatureSettings,
        sourceWalletSigners: walletSignature.signers,
        sourceOutputIndex: source.sourceOutputIndex,
        sourceTransactionHash: source.sourceTransactionHash,
        sourceLedger: source.sourceLedger,
        blockClaimHeight: source.blockClaimHeight,
        coinageHash: source.coinageHash,
      });
    }

    this.transaction.transactionHash = hashObject(this.transaction);

    return this.transaction;
  }
}

interface ISource {
  source: Partial<ITransactionSource>;
  centagons: bigint;
  wallet: Keyring;
}
