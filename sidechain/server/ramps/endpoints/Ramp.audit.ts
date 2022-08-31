import TimedCache from '@ulixee/commons/lib/TimedCache';
import { ISidechainApiTypes } from '@ulixee/specification/sidechain';
import ApiHandler from '../../utils/ApiHandler';
import RampDb from '../db';
import SidechainAudit from '../models/SidechainAudit';

const cachedResult = new TimedCache<ISidechainApiTypes['Ramp.audit']['result']>(10 * 60);

export default new ApiHandler('Ramp.audit', {
  async handler(args, options) {
    if (cachedResult.value) return cachedResult.value;

    const audit = await RampDb.transaction(
      client => SidechainAudit.latestSignedAudit(client),
      options,
    );

    cachedResult.value = {
      auditDate: audit.auditDate,
      usdcToArgonConversionRate: audit.usdcToArgonConversionRate,
      usdcReserves_e6: audit.usdcReservesE6,
      usdcReserveAddresses: audit.usdcAddresses.map((x, i) => {
        return {
          blockchain: x.blockchain,
          blockchainNetwork: x.blockchainNetwork,
          address: x.address,
          ownershipProof: audit.proofOfUsdcAddressCustody[i],
        };
      }),
      argonsInCirculation_e6: audit.argonsInCirculationE6,
    };

    return cachedResult.value;
  },
});
