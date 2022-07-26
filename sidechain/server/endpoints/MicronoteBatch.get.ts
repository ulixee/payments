import MicronoteBatchManager from '../lib/MicronoteBatchManager';
import ApiHandler from '../lib/ApiHandler';

export default new ApiHandler('MicronoteBatch.get', {
  async handler() {
    const batch = await MicronoteBatchManager.get();

    return { ...batch.getNoteParams() };
  },
});
