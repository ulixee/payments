import SharesCalculator from '@ulixee/block-utils/lib/SharesCalculator';
import {
  CoinageType,
  ICoinage,
  LedgerType,
  TransactionError,
  TransactionType,
} from '@ulixee/specification';
import BigNumber from 'bignumber.js';
import ITransaction from '@ulixee/specification/types/ITransaction';
import CodedError from '../lib/CodedError';
import TransactionBuilder from '../lib/TransactionBuilder';
import UnspentOutput from '../lib/UnspentOutput';
import AddressStore from '../store/AddressStore';
import UnspentOutputStore from '../store/UnspentOutputStore';

const miniumCoinageClaimCentagons = 100n;

export default function buildSharesCoinageClaim(
  utxoStore: UnspentOutputStore,
  addressStore: AddressStore,
  coinages: ICoinage[],
): { transaction: ITransaction; claims: { share: UnspentOutput; coinage: ICoinage }[] } {
  const shares = utxoStore.shares;
  const builder = new TransactionBuilder(TransactionType.COINAGE_CLAIM, LedgerType.STABLE);

  const claims: { share: UnspentOutput; coinage: ICoinage }[] = [];
  let centagonsClaimable = new BigNumber(0);
  for (const coinage of coinages) {
    if (coinage.type !== CoinageType.SHAREHOLDERS) {
      throw new CodedError(
        'Invalid coinage for a shareholder claim',
        TransactionError.INVALID_VARIABLE,
      );
    }
    const sharesAtHeight = SharesCalculator.getTotalSharesAtHeight(coinage.blockHeight);
    for (const share of shares) {
      if (utxoStore.hasClaimedCoinage(share, coinage)) continue;
      // sum total claimable based on portion of owned coinage tokens
      if (coinage.centagons) {
        // sum portion based on these output centagons divided by total allocated
        const portion = new BigNumber(share.output.centagons.toString()).dividedBy(
          sharesAtHeight.toString(),
        );
        const claimable = portion.multipliedBy(coinage.centagons.toString());
        centagonsClaimable = centagonsClaimable.plus(claimable);
        claims.push({ share, coinage });
      }
    }
  }

  const centagonsToClaim = BigInt(
    centagonsClaimable.integerValue(BigNumber.ROUND_FLOOR).toNumber(),
  );
  if (centagonsToClaim < miniumCoinageClaimCentagons) {
    throw new CodedError(
      'Minimum coinage claim centagons not exceeded',
      TransactionError.COINAGE_CLAIM_MINIMUM_NOT_REACHED,
    );
  }
  builder.addOutput({ address: addressStore.coinageClaimsAddress, centagons: centagonsToClaim });

  for (const claim of claims) {
    const share = claim.share;
    builder.addSource(
      {
        sourceOutputIndex: share.sourceOutputIndex,
        sourceLedger: share.sourceLedger,
        sourceTransactionHash: share.sourceTransactionHash,
        blockClaimHeight: claim.coinage.blockHeight,
        coinageHash: claim.coinage.hash,
      },
      share.centagons,
      addressStore.getAddress(share.address),
    );
  }

  return {
    transaction: builder.finalize(),
    claims,
  };
}
