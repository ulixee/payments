import { MicronoteBatchClosedError } from '../../utils/errors';
import MicronoteFunds from '../models/MicronoteFunds';
import ApiHandler from '../../utils/ApiHandler';
import BatchDb from '../db';
import { ActiveBatches } from '../index';

export default new ApiHandler('MicronoteBatch.findFund', {
  async handler({ batchSlug, address, microgons }, options) {
    const batch = await ActiveBatches.get(batchSlug);
    if (batch.isClosed) {
      throw new MicronoteBatchClosedError();
    }

    const batchDb = BatchDb.get(batchSlug);
    return await batchDb.transaction(async client => {
      const funds = new MicronoteFunds(client, batch.address, address);
      return await funds.find(microgons as number);
    }, options);
  },
});
