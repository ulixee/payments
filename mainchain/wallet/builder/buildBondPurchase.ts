import { ITransaction, LedgerType, TransactionType } from '@ulixee/specification';
import TransactionBuilder from '../lib/TransactionBuilder';
import KeyringStore from '../store/KeyringStore';
import UnspentOutputStore from '../store/UnspentOutputStore';
import UnspentOutput from '../lib/UnspentOutput';

export default function buildBondPurchase(
  uxtoStore: UnspentOutputStore,
  keyringStore: KeyringStore,
  currentBlockHeight: number,
  stableCentagonsToConvert: number | bigint,
  feeCentagons = 0n,
  expireAfterXBlocks?: number,
): { transaction: ITransaction; fromUnspentOutputs: UnspentOutput[]; changeNeeded: bigint } {
  const { fromUnspentOutputs, changeNeeded } = uxtoStore.getUnspentOutputsCoveringBalance(
    LedgerType.STABLE,
    BigInt(stableCentagonsToConvert) + feeCentagons,
  );
  let expirationHeight = null;
  if (expireAfterXBlocks !== undefined) {
    expirationHeight = (currentBlockHeight || 0) + expireAfterXBlocks;
  }
  const purchase = new TransactionBuilder(
    TransactionType.BOND_PURCHASE,
    LedgerType.STABLE,
    expirationHeight,
  );
  purchase.addOutput({
    address: keyringStore.bondsAddress,
    centagons: BigInt(stableCentagonsToConvert),
    isBond: true,
  });

  if (changeNeeded) {
    purchase.addOutput({ address: keyringStore.changeAddress, centagons: changeNeeded });
  }

  // now add all signed sources
  for (const source of fromUnspentOutputs) {
    purchase.addSource(source, source.centagons, keyringStore.getKeyring(source.address));
  }

  return { transaction: purchase.finalize(), fromUnspentOutputs, changeNeeded };
}
