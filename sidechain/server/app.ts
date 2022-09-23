import GracefulServer from '@ulixee/payment-utils/api/GracefulServer';
import Main from './main';
import batchEndpoints from './batch/endpoints';
import mainEndpoints from './main/endpoints';

const packageJson = require('./package.json');

export default new GracefulServer(
  'Ulixee Sidechain',
  packageJson.version,
  [...mainEndpoints, ...batchEndpoints],
  {
    healthCheck: () => Main.healthCheck(),
    onSignal: () => Main.stop(),
    rootMetadata: () => Main.info(),
  },
);
