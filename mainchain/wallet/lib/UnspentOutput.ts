import {
  ITransaction,
  ITransactionOutput,
  LedgerType,
  TransactionType,
} from '@ulixee/specification';

export default class UnspentOutput {
  public readonly output: ITransactionOutput;
  public confirmedBlocks: { blockHash?: Buffer; blockHeight: number }[] = [];
  public transactionType: TransactionType;
  public readonly key: string;

  constructor(
    readonly transaction: ITransaction,
    readonly sourceOutputIndex: number,
    readonly sourceLedger: LedgerType,
    readonly recordedAtBlockHeight: number,
  ) {
    this.output = transaction.outputs[sourceOutputIndex];
    this.transactionType = transaction.type;
    this.key = `${this.sourceTransactionHash.toString('hex')}_${this.sourceOutputIndex}`;
  }

  get centagons(): bigint {
    return this.output.centagons;
  }

  get sourceTransactionHash(): Buffer {
    return this.transaction.transactionHash;
  }

  get address(): string {
    return this.output.address;
  }

  get isConfirmed(): boolean {
    return this.confirmedBlocks.length > 0;
  }

  public recordConfirmedBlock(blockHeight: number, blockHash?: Buffer): UnspentOutput {
    this.confirmedBlocks.push({ blockHeight, blockHash });
    return this;
  }
}
