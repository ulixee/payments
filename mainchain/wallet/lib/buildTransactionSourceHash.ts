import { hashObject } from '@ulixee/commons/lib/hashUtils';
import {
  ITransaction,
  ITransactionOutput,
  ITransactionSource,
  ITransactionSourceSignatureData,
} from '@ulixee/specification';
import assert = require('assert');
import LedgerType from '@ulixee/specification/types/LedgerType';
import { TransactionSourceSignatureDataSchema } from '@ulixee/specification/types/ITransactionSourceSignatureData';

/**
 *  sha256 256 of TransactionSourceSignatureData json encoding
 */
export default function buildTransactionSourceHash(
  transaction: Pick<ITransaction, 'type' | 'version' | 'outputs'>,
  source: ITransactionSource,
  ledger: LedgerType,
  usedOutput: Pick<ITransactionOutput, 'centagons' | 'address'>,
): Buffer {
  assert(transaction.outputs.length, 'Must have outputs already on message');
  assert(usedOutput, 'Must provide an unspent source');
  assert(transaction, 'Must provide the transaction containing this source');

  const sigData: ITransactionSourceSignatureData = {
    // tx details
    version: transaction.version,
    type: transaction.type,
    ledger,
    outputs: transaction.outputs.map(x => ({
      address: x.address,
      centagons: x.centagons,
      isBond: x.isBond,
      isBurned: x.isBurned,
    })),
    // source details
    sourceLedger: source.sourceLedger,
    sourceTransactionHash: source.sourceTransactionHash,
    sourceTransactionOutputIndex: source.sourceOutputIndex,
    coinageHash: source.coinageHash,
    // original output details
    address: usedOutput.address,
    addressSignatureSettings: source.sourceAddressSignatureSettings,
    centagons: usedOutput.centagons,
  };
  TransactionSourceSignatureDataSchema.parse(sigData);

  return hashObject(sigData);
}
