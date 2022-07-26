import { ICoinage } from '@ulixee/specification';
import BigNumber from 'bignumber.js';
import Constants from './Constants';

export default class SharesCalculator {
  public static sharesAllocatedAtHeight: { [height: number]: bigint } = {};

  /**
   * Calculate how many shares are in existence at this point in the block history
   *
   * NOTE: this is a memoized function
   */
  public static getTotalSharesAtHeight(height: number): bigint {
    // cache results;
    if (this.sharesAllocatedAtHeight[height]) {
      return this.sharesAllocatedAtHeight[height];
    }
    if (height >= Constants.miningRewardsEndHeight) {
      return Constants.totalShareCentagons; // 10M centagons
    }
    if (height === Constants.miningRewardsEndHeight) {
      return Constants.totalShareCentagons - Constants.miningRewardsLastBlockCentagons;
    }
    let totalMined = 0n;
    let rewards = Constants.miningRewardsBaseShareCentagons;
    // start at 1!! no rewards for genesis block
    for (let i = 1; i <= height; i += 1) {
      if (i >= Constants.miningRewardsDecayStopInterval) {
        rewards = Constants.miningRewardsDecayStopCentagons;
      } else {
        if (i % Constants.miningRewardsDayInterval === 0) {
          rewards -= Constants.miningRewardsDayDecay;
        }
        if (i % Constants.miningRewardsPhaseInterval === 0) {
          rewards -= Constants.miningRewardsPhaseDecay;
        }
      }
      totalMined += rewards;
    }
    // record in cache
    this.sharesAllocatedAtHeight[height] = totalMined;
    return totalMined;
  }

  /**
   * Block closing reward share centagons
   */
  public static getMiningRewardSharesForHeight(blockHeight: number): bigint {
    if (blockHeight > Constants.miningRewardsEndHeight) {
      return 0n;
    }
    if (blockHeight === Constants.miningRewardsEndHeight) {
      return Constants.miningRewardsLastBlockCentagons;
    }
    if (blockHeight >= Constants.miningRewardsDecayStopInterval) {
      return Constants.miningRewardsDecayStopCentagons;
    }
    const dayDecay =
      BigInt(Math.floor(blockHeight / Constants.miningRewardsDayInterval)) *
      Constants.miningRewardsDayDecay;

    const phaseDecay =
      BigInt(Math.floor(blockHeight / Constants.miningRewardsPhaseInterval)) *
      Constants.miningRewardsPhaseDecay;

    return Constants.miningRewardsBaseShareCentagons - dayDecay - phaseDecay;
  }

  /**
   * Determine how many centagons this ownership has rights to
   */
  public static getSharePortion(coinage: ICoinage, shareCentagonsOwned: bigint): bigint {
    const totalCoinageCentagonsAtHeight = SharesCalculator.getTotalSharesAtHeight(
      coinage.blockHeight,
    );

    // figure out share of centagons
    // NOTE: BigInts always round down
    const tokenShare = new BigNumber(
      (shareCentagonsOwned * coinage.centagons).toString(),
    ).dividedBy(totalCoinageCentagonsAtHeight.toString());

    // return shares times the number coinage
    return BigInt(tokenShare.toString(10));
  }
}
