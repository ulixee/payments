import {
  ICoinage,
  ITransaction,
  LedgerType,
  TransactionError,
  TransactionType,
} from '@ulixee/specification';
import CodedError from '../lib/CodedError';
import UnspentOutput from '../lib/UnspentOutput';

export default class UnspentOutputStore {
  public readonly shares: Set<UnspentOutput> = new Set();
  public readonly stables: Set<UnspentOutput> = new Set();
  public readonly bonds: Set<UnspentOutput> = new Set();
  public readonly coinageClaims: { [outputKey: string]: string[] } = {};

  public getUnspentOutputs(ledger: LedgerType): Set<UnspentOutput> {
    if (ledger === LedgerType.SHARES) {
      return this.shares;
    }
    if (ledger === LedgerType.STABLE) {
      return this.stables;
    }
  }

  public get allUnspent(): UnspentOutput[] {
    return [...this.shares, ...this.stables, ...this.bonds];
  }

  public getUnspentOutputsCoveringBalance(
    ledgerType: LedgerType,
    centagons: bigint | number,
  ): { fromUnspentOutputs: UnspentOutput[]; changeNeeded: bigint } {
    const unspentOutputs: UnspentOutput[] = [];
    const allUnspentOutputsSmallestToBiggest = [...this.getUnspentOutputs(ledgerType)]
      .filter(x => x.isConfirmed)
      .sort((a, b) => {
        return Number(a.output.centagons - b.output.centagons);
      });

    centagons = BigInt(centagons);
    let remaining = centagons;
    let total = 0n;
    for (const unspentOutput of allUnspentOutputsSmallestToBiggest) {
      // can't transfer bonds or burned coins
      if (unspentOutput.output.isBurned || unspentOutput.output.isBond) {
        continue;
      }
      unspentOutputs.push(unspentOutput);
      total += unspentOutput.output.centagons;
      remaining -= unspentOutput.output.centagons;
      if (remaining <= 0) {
        break;
      }
    }

    if (remaining > 0) {
      throw new CodedError(
        `Wallet doesn't have enough ${LedgerType[ledgerType]} centagons for this transaction: ${remaining} short`,
        TransactionError.INSUFFICIENT_CENTAGONS,
      );
    }

    return {
      fromUnspentOutputs: unspentOutputs,
      changeNeeded: total - centagons,
    };
  }

  public recordBondRedemption(
    unspentBondOutput: UnspentOutput,
    transaction: ITransaction,
    blockHeight: number,
  ): void {
    if (transaction.type === TransactionType.BOND_REDEMPTION) {
      this.bonds.delete(unspentBondOutput);
      this.stables.add(
        new UnspentOutput(transaction, 0, LedgerType.STABLE, blockHeight).recordConfirmedBlock(
          blockHeight,
        ),
      );
      if (transaction.outputs.length > 1 && transaction.outputs[1].isBond) {
        this.bonds.add(
          new UnspentOutput(transaction, 1, LedgerType.STABLE, blockHeight).recordConfirmedBlock(
            blockHeight,
          ),
        );
      }
    }
  }

  public recordConfirmedBlock(
    unspentOutput: UnspentOutput,
    blockHeight: number,
    blockHash: Buffer,
  ): void {
    unspentOutput.recordConfirmedBlock(blockHeight, blockHash);
  }

  public recordCoinageClaim(
    transaction: ITransaction,
    claims: { share: UnspentOutput; coinage: ICoinage }[],
    preliminaryBlockHeight: number,
  ): UnspentOutput {
    const earned = new UnspentOutput(transaction, 0, LedgerType.STABLE, preliminaryBlockHeight);
    this.stables.add(earned);
    for (const source of claims) {
      this.coinageClaims[source.share.key] ??= [];
      this.coinageClaims[source.share.key].push(source.coinage.hash.toString('hex'));
    }
    return earned;
  }

  public recordBondPurchase(
    transaction: ITransaction,
    fromUnspentOutputs: UnspentOutput[],
    preliminaryBlockHeight: number,
  ): void {
    this.bonds.add(new UnspentOutput(transaction, 0, LedgerType.STABLE, preliminaryBlockHeight));

    let changeUnspentOutput: UnspentOutput;
    if (transaction.outputs.length > 1) {
      changeUnspentOutput = new UnspentOutput(
        transaction,
        1,
        LedgerType.STABLE,
        preliminaryBlockHeight,
      );
      this.stables.add(changeUnspentOutput);
    }

    fromUnspentOutputs.forEach(x => this.stables.delete(x));
  }

  public recordTransfer(
    transaction: ITransaction,
    ledgerType: LedgerType,
    fromUnspentOutputs: UnspentOutput[],
    changeAddress: string,
    preliminaryBlockHeight: number,
  ): { transferred: UnspentOutput[]; changeOutput: UnspentOutput } {
    const ledger = this.getUnspentOutputs(ledgerType);

    const transferred: UnspentOutput[] = [];
    let changeOutput: UnspentOutput;
    let idx = 0;
    for (const output of transaction.outputs) {
      if (output.address === changeAddress) {
        changeOutput = new UnspentOutput(
          transaction,
          idx,
          LedgerType.STABLE,
          preliminaryBlockHeight,
        );
        ledger.add(changeOutput);
      } else {
        const newUnspentOutput = new UnspentOutput(
          transaction,
          idx,
          ledgerType,
          preliminaryBlockHeight,
        );
        transferred.push(newUnspentOutput);
      }
      idx += 1;
    }

    fromUnspentOutputs.forEach(x => ledger.delete(x));

    return {
      transferred,
      changeOutput,
    };
  }

  public hasClaimedCoinage(share: UnspentOutput, coinage: ICoinage): boolean {
    const claims = this.coinageClaims[share.key];
    if (!claims) return false;
    return claims.includes(coinage.hash.toString('hex'));
  }
}
