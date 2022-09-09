import GracefulServer from '@ulixee/payment-utils/api/GracefulServer';
import RampCreateTransferInAddress from './Ramp.createTransferInAddress';
import RampSettings from './Ramp.audit';
import RampApp from '../lib/RampApp';

const packageJson = require('../package.json');

export function createServer(): GracefulServer {
  return new GracefulServer(
    'Ulixee Ramps',
    packageJson.version,
    [RampSettings, RampCreateTransferInAddress],
    {
      healthCheck: () => RampApp.db.healthCheck(),
      onSignal: () => RampApp.stop(),
    },
  );
}
