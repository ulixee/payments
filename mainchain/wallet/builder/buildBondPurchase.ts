import { ITransaction, LedgerType, TransactionType } from '@ulixee/specification';
import TransactionBuilder from '../lib/TransactionBuilder';
import AddressStore from '../store/AddressStore';
import UnspentOutputStore from '../store/UnspentOutputStore';
import UnspentOutput from '../lib/UnspentOutput';

export default function buildBondPurchase(
  utxoStore: UnspentOutputStore,
  addressStore: AddressStore,
  currentBlockHeight: number,
  stableCentagonsToConvert: number | bigint,
  feeCentagons = 0n,
  expireAfterXBlocks?: number,
): { transaction: ITransaction; fromUnspentOutputs: UnspentOutput[]; changeNeeded: bigint } {
  const { fromUnspentOutputs, changeNeeded } = utxoStore.getUnspentOutputsCoveringBalance(
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
    address: addressStore.bondsAddress,
    centagons: BigInt(stableCentagonsToConvert),
    isBond: true,
  });

  if (changeNeeded) {
    purchase.addOutput({ address: addressStore.changeAddress, centagons: changeNeeded });
  }

  // now add all signed sources
  for (const source of fromUnspentOutputs) {
    purchase.addSource(source, source.centagons, addressStore.getAddress(source.address));
  }

  return { transaction: purchase.finalize(), fromUnspentOutputs, changeNeeded };
}
