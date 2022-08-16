import Constants from '../lib/Constants';
import SharesCalculator from '../lib/SharesCalculator';

test('calculate halving of mining rewards', () => {
  const halvingBlock1 = SharesCalculator.getMiningRewardSharesForHeight(0);
  expect(halvingBlock1).toBe(Constants.miningRewardsBaseShareCentagons);
  const halvingBlock2 = SharesCalculator.getMiningRewardSharesForHeight(
    Constants.miningRewardsDayInterval,
  );
  expect(halvingBlock2).toBe(
    Constants.miningRewardsBaseShareCentagons - Constants.miningRewardsDayDecay,
  );

  expect(
    SharesCalculator.getMiningRewardSharesForHeight(Constants.miningRewardsDayInterval + 1),
  ).toBe(Constants.miningRewardsBaseShareCentagons - Constants.miningRewardsDayDecay);

  // at block 118, we will have 118 blocks at base price, and 1 at reduced
  expect(SharesCalculator.getTotalSharesAtHeight(Constants.miningRewardsDayInterval)).toBe(
    Constants.miningRewardsBaseShareCentagons * BigInt(Constants.miningRewardsDayInterval - 1) +
      1n * (Constants.miningRewardsBaseShareCentagons - Constants.miningRewardsDayDecay),
  );

  expect(
    SharesCalculator.getMiningRewardSharesForHeight(Constants.miningRewardsDayInterval * 2),
  ).toBe(Constants.miningRewardsBaseShareCentagons - Constants.miningRewardsDayDecay * 2n);

  // at block 118, we will have 118 blocks at base price, and 1 at reduced
  expect(SharesCalculator.getTotalSharesAtHeight(Constants.miningRewardsDayInterval * 2)).toBe(
    Constants.miningRewardsBaseShareCentagons * BigInt(Constants.miningRewardsDayInterval - 1) +
      BigInt(Constants.miningRewardsDayInterval) *
        (Constants.miningRewardsBaseShareCentagons - Constants.miningRewardsDayDecay) +
      1n * (Constants.miningRewardsBaseShareCentagons - 2n * Constants.miningRewardsDayDecay),
  );

  expect(
    SharesCalculator.getMiningRewardSharesForHeight(Constants.miningRewardsDayInterval * 2 + 1),
  ).toBe(Constants.miningRewardsBaseShareCentagons - BigInt(Constants.miningRewardsDayDecay) * 2n);

  expect(
    SharesCalculator.getMiningRewardSharesForHeight(Constants.miningRewardsPhaseInterval),
  ).toBe(
    Constants.miningRewardsBaseShareCentagons -
      Constants.miningRewardsPhaseDecay -
      BigInt(
        Math.floor(Constants.miningRewardsPhaseInterval / Constants.miningRewardsDayInterval),
      ) *
        Constants.miningRewardsDayDecay,
  );

  // check decay stop point
  expect(
    SharesCalculator.getMiningRewardSharesForHeight(Constants.miningRewardsDecayStopInterval),
  ).toBe(Constants.miningRewardsDecayStopCentagons);

  expect(
    SharesCalculator.getMiningRewardSharesForHeight(Constants.miningRewardsDecayStopInterval * 2),
  ).toBe(Constants.miningRewardsDecayStopCentagons);

  expect(SharesCalculator.getMiningRewardSharesForHeight(Constants.miningRewardsEndHeight)).toBe(
    Constants.miningRewardsLastBlockCentagons,
  );

  expect(SharesCalculator.getTotalSharesAtHeight(Constants.miningRewardsEndHeight)).toBe(
    Constants.totalShareCentagons,
  );

  expect(SharesCalculator.getTotalSharesAtHeight(Constants.miningRewardsEndHeight - 1)).toBe(
    Constants.totalShareCentagons - Constants.miningRewardsLastBlockCentagons,
  );
});

// eslint-disable-next-line jest/no-disabled-tests
test.skip('show period block rewards and total mined', () => {
  let totalMined = 0n;
  let rewards = Constants.miningRewardsBaseShareCentagons;
  let i = 1;
  let phase = 1;
  while (totalMined < Constants.totalShareCentagons) {
    if (i === Constants.miningRewardsEndHeight) {
      rewards = Constants.miningRewardsLastBlockCentagons;
    } else if (i >= Constants.miningRewardsDecayStopInterval) {
      rewards = Constants.miningRewardsDecayStopCentagons;
    } else {
      if (i % Constants.miningRewardsPhaseInterval === Constants.miningRewardsPhaseInterval - 1) {
        console.log(
          'Phase %s. Ending rewards: %s   Total: %s    Block: %s',
          phase,
          rewards,
          totalMined / 100n,
          i,
        );
        phase += 1;
      }
      if (i % Constants.miningRewardsDayInterval === 0) {
        rewards -= Constants.miningRewardsDayDecay;
      }
      if (i % Constants.miningRewardsPhaseInterval === 0) {
        rewards -= Constants.miningRewardsPhaseDecay;
      }
    }
    totalMined += rewards;
    i += 1;
  }
  expect(totalMined).toBe(Constants.totalShareCentagons);
});
