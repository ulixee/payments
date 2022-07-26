import BlockManager from '../lib/BlockManager';
import { NotFoundError } from '../lib/errors';
import FundingTransferOut from '../models/FundingTransferOut';
import db from '../lib/defaultDb';
import ApiHandler from '../lib/ApiHandler';
import SecurityMainchainBlock, {
  ISecurityMainchainBlockRecord,
} from '../models/SecurityMainchainBlock';

export default new ApiHandler('FundingTransfer.status', {
  async handler(payload, options) {
    return await db.transaction(async client => {
      const transfer = await FundingTransferOut.find(client, payload.noteHash);

      if (!transfer) {
        throw new NotFoundError('Funding transfer not found');
      }

      let blocks: ISecurityMainchainBlockRecord[] = [];
      // if this has been recorded in a transaction, check for the latest hashes
      if (transfer.transactionHash) {
        blocks = await SecurityMainchainBlock.getRecordedBlocks(client, transfer.transactionHash);
      }
      return {
        transactionHash: transfer.transactionHash,
        currentBlockHeight: await BlockManager.currentBlockHeight(),
        blocks: blocks.map(x => ({
          blockHeight: x.blockHeight,
          blockHash: x.blockHash,
        })),
      };
    }, options);
  },
});
