import TimedCache from '@ulixee/commons/lib/TimedCache';
import { ISidechainApiTypes } from '@ulixee/specification/sidechain';
import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import RampApp from '../lib/RampApp';
import RampAudit from '../models/RampAudit';

const cachedResult = new TimedCache<ISidechainApiTypes['Ramp.audit']['result']>(10 * 60);

export default new ApiHandler('Ramp.audit', {
  async handler(args, options) {
    if (cachedResult.value) return cachedResult.value;

    const audit = await RampApp.db.transaction(
      client => RampAudit.latestSignedAudit(client),
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
