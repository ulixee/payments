import { hashObject } from '@ulixee/commons/lib/hashUtils';
import {
  ITransaction,
  ITransactionOutput,
  ITransactionSource,
  LedgerType,
  TransactionError,
  TransactionType,
} from '@ulixee/specification';
import AddressSignature from '@ulixee/crypto/lib/AddressSignature';
import Address from '@ulixee/crypto/lib/Address';
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
    wallet: Address,
  ): TransactionBuilder {
    if (!wallet) {
      throw new CodedError('No wallet specified for source', TransactionError.INVALID_SOURCES);
    }
    this.sources.push({ address: wallet, source, centagons });
    return this;
  }

  public finalize(): ITransaction {
    const isClaim = this.type === TransactionType.COINAGE_CLAIM;

    for (const utxo of this.sources) {
      const { source, address, centagons } = utxo;
      const settings = address.addressSettings;
      const merkle = address.ownersMerkleTree;
      const signers = isClaim ? address.claimSigners : address.transferSigners;
      source.sourceAddressSignatureSettings = AddressSignature.buildSignatureSettings(
        merkle,
        settings,
        isClaim,
      );

      const utxoSourceHash = buildTransactionSourceHash(
        this.transaction,
        source as any,
        this.ledger,
        {
          centagons,
          address: address.bech32,
        },
      );

      const addressSignature = AddressSignature.create(
        utxoSourceHash,
        signers,
        merkle,
        settings,
        isClaim,
      );

      this.transaction.sources.push({
        sourceAddressSignatureSettings: source.sourceAddressSignatureSettings,
        sourceAddressSigners: addressSignature.signers,
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
  address: Address;
}
