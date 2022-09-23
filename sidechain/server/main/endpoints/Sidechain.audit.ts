import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import moment = require('moment');
import TimedCache from '@ulixee/commons/lib/TimedCache';
import { ISidechainApiTypes } from '@ulixee/specification/sidechain';
import MainDb from '../db';
import Note from '../models/Note';

// cache for an hour
export const cachedResult = new TimedCache<ISidechainApiTypes['Sidechain.audit']['result']>(60 * 60);

export default new ApiHandler('Sidechain.audit', {
  async handler(args, options) {
    if (cachedResult.value) return cachedResult.value;

    cachedResult.value = await MainDb.transaction(async db => {
      const circulation = await Note.totalCirculation(db);
      const startOfDay = moment().startOf('date').toDate();
      const burnedCentagonsYesterday = await Note.burnedCentagonsFrom(
        db,
        moment(startOfDay).add(-1, 'days').toDate(),
        startOfDay,
      );
      const burnedOver30Days = await Note.burnedCentagonsFrom(
        db,
        moment(startOfDay).add(-30, 'days').toDate(),
        startOfDay,
      );
      const averageArgonsBurned = burnedOver30Days / 30n;

      return {
        auditDate: startOfDay,
        argonsInCirculation_e2: circulation,
        argonsBurnedYesterday_e2: burnedCentagonsYesterday,
        argonsBurnedRolling30DayAverage_e2: averageArgonsBurned,
      };
    }, options);

    return cachedResult.value;
  },
});
