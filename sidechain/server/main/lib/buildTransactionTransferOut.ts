import { LedgerType, TransactionType, ITransaction } from '@ulixee/specification';
import TransactionBuilder from '@ulixee/wallet/lib/TransactionBuilder';
import Address from '@ulixee/crypto/lib/Address';
import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';
import { NotFoundError } from '@ulixee/payment-utils/lib/errors';
import config from '../../config';
import MainchainTransaction from '../models/MainchainTransaction';
import Security, { IPayout } from '../models/Security';

export default async function buildTransactionTransferOut(
  client: PgClient<DbType.Main>,
  payouts: IPayout[],
  isBurn?: boolean,
): Promise<{
  unspentOutputs;
  sidechainAddress: Address;
  centagons: bigint;
  transaction: ITransaction;
}> {
  const sidechainAddress = config.mainchain.addresses[0];
  const centagons = payouts.reduce((total, entry) => total + entry.centagons, 0n);
  const unspentOutputs = await Security.lockUnspentFunds(client, centagons);
  const outputs: (IPayout & {
    outIndex: number;
  })[] = [];

  // build transaction from unspent outputs
  const builder = new TransactionBuilder(TransactionType.TRANSFER, LedgerType.STABLE);
  let outIndex = 0;
  for (const payout of payouts) {
    builder.addOutput({ address: payout.address, centagons: payout.centagons, isBurned: isBurn });
    outputs.push({ ...payout, outIndex });
    outIndex += 1;
  }
  if (unspentOutputs.change) {
    builder.addOutput({
      address: sidechainAddress.bech32,
      centagons: unspentOutputs.change,
      isSidechained: true,
    });
  }
  for (const output of unspentOutputs.outputs) {
    const address = config.mainchain.addressesByBech32[output.transactionOutputAddress];
    if (!address) {
      throw new NotFoundError(
        'Mainchain Address details not found',
        output.transactionOutputAddress,
      );
    }
    builder.addSource(
      {
        sourceLedger: LedgerType.STABLE,
        sourceOutputIndex: output.transactionOutputIndex,
        sourceTransactionHash: output.transactionHash,
      },
      output.centagons,
      address,
    );
  }

  const transaction = builder.finalize();

  await Security.recordSpend(
    client,
    outputs,
    unspentOutputs.outputs,
    transaction,
    sidechainAddress.bech32,
    unspentOutputs.change > 0,
    isBurn,
  );

  await MainchainTransaction.fromTransaction(client, transaction).save();

  return {
    unspentOutputs,
    sidechainAddress,
    centagons,
    transaction,
  };
}
