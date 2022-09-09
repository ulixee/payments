import Constants from '@ulixee/block-utils/lib/Constants';
import MainchainApiHandler from '../lib/MainchainApiHandler';

export default new MainchainApiHandler('Block.settings', {
  async handler(args, options) {
    const block = await options.blockLookup.getAtHeight(args.blockHeight);
    const approvedSidechains = await options.blockLookup.getApprovedSidechainsAtHeight(
      args.blockHeight,
    );

    const { height, hash: blockHash, xoredCandidateAverage, xoredCandidateDistance } = block.header;

    let bitSamplingsInBlock = Constants.bitSampling.requiredInBlock;
    if (
      block.bitSampling &&
      block.bitSampling.bitDatumHistories.length < Constants.bitSampling.requiredInBlock
    ) {
      bitSamplingsInBlock = block.bitSampling.bitDatumHistories.length;
    }

    let xoredCandidatesMinimum = Math.floor(
      (xoredCandidateAverage * Constants.datumRules.xoredCandidates.percentRequired) / 100,
    );
    if (xoredCandidatesMinimum < Constants.datumRules.xoredCandidates.floor) {
      xoredCandidatesMinimum = Constants.datumRules.xoredCandidates.floor;
    }

    // TODO: constants should move into blockchain and governance
    return {
      height,
      blockHash,
      xoredCandidateDistance,
      datum: {
        xoredCandidatesMinimum,
        secondPingPercent: Constants.datumRules.secondPingPercent,
        auditorsCount: Constants.datumRules.auditorsCount,
      },
      networkNodes: 1,
      nextLinkTarget: block.header.nextLinkTarget,
      bitSamplingsInBlock,
      bitSamplingBlockAge: Constants.bitSampling.blockAge,
      minimumMicronoteBurnPercent: Constants.sidechainMinimumBurnPercent,
      sidechains: approvedSidechains.map(x => ({
        rootIdentity: x.rootIdentity,
        url: x.url,
      })),
    };
  },
});
