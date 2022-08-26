import ApiHandler from '../../utils/ApiHandler';
import MicronoteBatchManager from '../lib/MicronoteBatchManager';

export default new ApiHandler('Sidechain.openBatches', {
  handler() {
    const active = MicronoteBatchManager.getOpenBatches();
    const giftCardBatch = MicronoteBatchManager.giftCardBatch;

    return Promise.resolve({
      micronote: active.map(x => x.getNoteParams()),
      giftCard: giftCardBatch.getNoteParams(),
    });
  },
});
