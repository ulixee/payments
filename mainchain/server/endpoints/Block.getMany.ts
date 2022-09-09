import { IBlock } from '@ulixee/specification';
import MainchainApiHandler from '../lib/MainchainApiHandler';

export default new MainchainApiHandler('Block.getMany', {
  async handler({ blockHashes, blockHeights }, { blockLookup }) {
    let blocks: IBlock[] = [];
    if (blockHeights?.length) {
      blocks = await blockLookup.getAtHeights(blockHeights);
    }
    if (blockHashes?.length) {
      for (const hash of blockHashes) {
        const block = await blockLookup.getWithHash(hash);
        blocks.push(block);
      }
    }
    return {
      blocks,
    };
  },
});
