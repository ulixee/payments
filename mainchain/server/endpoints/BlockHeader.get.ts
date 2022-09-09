import MainchainApiHandler from '../lib/MainchainApiHandler';

export default new MainchainApiHandler('BlockHeader.get', {
  async handler(args, { blockLookup }) {
    let block = await blockLookup.getWithHash(args.hash);
    let isOnFork = false;
    if (block === null && args.includeFork) {
      block = await blockLookup.getForkedWithHash(args.hash);
      if (block) isOnFork = true;
    }

    return {
      header: block ? block.header : null,
      isOnFork,
    };
  },
});
