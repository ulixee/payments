import { MicronoteBatchClosedError } from '../lib/errors';
import MicronoteBatchManager from '../lib/MicronoteBatchManager';
import MicronoteFunds from '../models/MicronoteFunds';
import ApiHandler from '../lib/ApiHandler';
import MicronoteBatchDb from '../lib/MicronoteBatchDb';

export default new ApiHandler('MicronoteBatch.findFund', {
  async handler({ batchSlug, address, microgons }, options) {
    const batch = await MicronoteBatchManager.get(batchSlug);
    if (batch.isClosed) {
      throw new MicronoteBatchClosedError();
    }

    const db = await MicronoteBatchDb.get(batchSlug);
    return await db.transaction(async client => {
      const funds = new MicronoteFunds(client, batch, address);
      return await funds.find(microgons as number);
    }, options);
  },
});
