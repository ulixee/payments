import { loadEnv, parseEnvBigint, parseEnvInt } from '@ulixee/commons/lib/envUtils';
import Constants from '@ulixee/block-utils/lib/Constants';
import moment = require('moment');

loadEnv(__dirname);
const env = process.env;

const settings = {
  port: parseEnvInt(env.MAINCHAIN_LISTEN_PORT),
  genesisSettings: {
    authorizedSidechains: [
      {
        rootIdentity: env.AUTHORIZED_SIDECHAIN_ROOT_IDENTITY,
        transferInAddress: env.AUTHORIZED_SIDECHAIN_TRANSFER_IN_ADDRESS,
        url: env.AUTHORIZED_SIDECHAIN_URL,
      },
    ],
    startingDifficulty: Constants.easiestMiningDifficulty,
    bootstrappedReserves: [
      {
        centagons: parseEnvBigint(env.RESERVES_FUNDING_1_CENTAGONS),
        address: env.RESERVES_FUNDING_1_SIDECHAIN_ADDRESS,
        time: env.RESERVES_FUNDING_1_DATE
          ? moment(env.RESERVES_FUNDING_1_DATE, 'YYYY-MM-DD').toDate()
          : null,
      },
    ],
  },
};
export default settings;
