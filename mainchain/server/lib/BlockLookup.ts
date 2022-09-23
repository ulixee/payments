import { IBlock } from '@ulixee/specification';
import IAuthorizedSidechain from '@ulixee/specification/types/IAuthorizedSidechain';
import buildGenesisBlock from './buildGenesisBlock';

export default class BlockLookup {
  public genesisBlock = buildGenesisBlock();
  public blockchain = [this.genesisBlock];

  public close(): Promise<void> {
    return Promise.resolve();
  }

  // eslint-disable-next-line require-await,@typescript-eslint/require-await
  public async getAtHeight(height: number): Promise<IBlock> {
    height ??= 0;
    return this.blockchain[height];
  }

  // eslint-disable-next-line require-await,@typescript-eslint/require-await
  public async getAtHeights(heights: number[]): Promise<IBlock[]> {
    return heights.map(i => this.blockchain[i]);
  }

  // eslint-disable-next-line require-await,@typescript-eslint/require-await
  public async getWithHash(hash: Buffer): Promise<IBlock> {
    if (this.genesisBlock.header.hash.equals(hash)) return this.genesisBlock;
  }

  // eslint-disable-next-line require-await,@typescript-eslint/require-await
  public async getForkedWithHash(hash: Buffer): Promise<IBlock> {
    if (this.genesisBlock.header.hash.equals(hash)) return this.genesisBlock;
  }

  public async getApprovedSidechainsAtHeight(height?: number): Promise<IAuthorizedSidechain[]> {
    const block = await this.getAtHeight(height ?? 0);
    return block.sidechainGovernance.authorizedSidechains;
  }
}
