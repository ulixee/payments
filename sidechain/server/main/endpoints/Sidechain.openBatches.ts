import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import MicronoteBatchManager from '../lib/MicronoteBatchManager';

export default new ApiHandler('Sidechain.openBatches', {
  handler() {
    const active = MicronoteBatchManager.getOpenBatches();

    return Promise.resolve({
      micronote: active.map(x => x.getNoteParams()),
    });
  },
});
