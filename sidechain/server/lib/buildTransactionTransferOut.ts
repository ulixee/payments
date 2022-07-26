import { LedgerType, TransactionType, ITransaction } from '@ulixee/specification';
import TransactionBuilder from '@ulixee/wallet/lib/TransactionBuilder';
import Keyring from '@ulixee/crypto/lib/Keyring';
import config from '../config';
import MainchainTransaction from '../models/MainchainTransaction';
import Security, { IPayout } from '../models/Security';
import PgClient from "./PgClient";
import { DbType } from "./PgPool";
import { NotFoundError } from './errors';

const mainchainWalletsByAddress: { [address: string]: Keyring } = {};
for (const wallet of config.mainchain.wallets) {
  mainchainWalletsByAddress[wallet.address] = wallet;
}

export default async function buildTransactionTransferOut(
  client: PgClient<DbType.Default>,
  payouts: IPayout[],
  isBurn?: boolean,
): Promise<{
  unspentOutputs;
  sidechainWallet: Keyring;
  centagons: bigint;
  transaction: ITransaction;
}> {
  const sidechainWallet = config.mainchain.wallets[0];
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
      address: sidechainWallet.address,
      centagons: unspentOutputs.change,
      isSidechained: true,
    });
  }
  for (const output of unspentOutputs.outputs) {
    const wallet = mainchainWalletsByAddress[output.transactionOutputAddress];
    if (!wallet) {
      throw new NotFoundError(
        'Mainchain wallet details not found',
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
      wallet,
    );
  }

  const transaction = builder.finalize();

  await Security.recordSpend(
    client,
    outputs,
    unspentOutputs.outputs,
    transaction,
    sidechainWallet.address,
    unspentOutputs.change > 0,
    isBurn,
  );

  await MainchainTransaction.fromTransaction(client, transaction).save();

  return {
    unspentOutputs,
    sidechainWallet,
    centagons,
    transaction,
  };
}
