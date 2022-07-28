import { ActiveBatches } from '..';
import ApiHandler from '../../utils/ApiHandler';

export default new ApiHandler('MicronoteBatch.get', {
  handler() {
    return Promise.resolve(ActiveBatches.getCurrent());
  },
});
