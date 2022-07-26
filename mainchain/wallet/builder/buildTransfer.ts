import { ITransaction, TransactionType } from '@ulixee/specification';
import IAddressTransfer from '../interfaces/IAddressTransfer';
import TransactionBuilder from '../lib/TransactionBuilder';
import UnspentOutput from '../lib/UnspentOutput';
import KeyringStore from '../store/KeyringStore';

export default function buildTransfer(
  fromUnspentOutputs: UnspentOutput[],
  keyringStore: KeyringStore,
  transfers: IAddressTransfer[],
  feeCentagons: number | bigint,
): ITransaction {
  const ledgerType = fromUnspentOutputs[0].sourceLedger;
  const transfer = new TransactionBuilder(TransactionType.TRANSFER, ledgerType);

  let outputCentagons = 0n;
  for (const entry of transfers) {
    outputCentagons += entry.centagons;
    transfer.addOutput({ address: entry.toAddress, centagons: entry.centagons });
  }

  const totalUnspentCentagons = fromUnspentOutputs.reduce(
    (sum, entry) => sum + entry.output.centagons,
    0n,
  );

  const changeNeeded = totalUnspentCentagons - outputCentagons - BigInt(feeCentagons);

  if (changeNeeded) {
    transfer.addOutput({ address: keyringStore.changeAddress, centagons: changeNeeded });
  }

  // now add all signed sources
  for (const uxto of fromUnspentOutputs) {
    transfer.addSource(uxto, uxto.centagons, keyringStore.getKeyring(uxto.address));
  }

  return transfer.finalize();
}
