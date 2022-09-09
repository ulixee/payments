import Address from '@ulixee/crypto/lib/Address';
import { loadEnv, parseEnvInt, parseEnvList } from '@ulixee/commons/lib/envUtils';
import { nanoid } from 'nanoid';
import moment = require('moment');
import EthereumHDWallet from './lib/EthereumHDWallet';
import { IEthereumProviderConfig } from './lib/USDCApi';

loadEnv(__dirname);
const env = process.env;

const baseUrl = env.RAMPS_HOST ? new URL(env.RAMPS_HOST) : { port: 0, href: 'http://localhost:' };

const prng = nanoid(5).toLowerCase().replace(/[-]/g, '_');

const settings = {
  port: parseEnvInt(env.RAMPS_LISTEN_PORT) ?? baseUrl.port,
  baseUrl: baseUrl.href,
  db: {
    host: env.PGHOST,
    port: parseEnvInt(env.PGPORT) || undefined,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    database: replacePRNG(env.RAMPS_DB),
  },
  sidechainHost: env.SIDECHAIN_HOST,
  cpiBaseline: {
    date: moment(env.CPI_BASELINE_DATE, 'YYYY-MM').format('YYYY-MM-DD'),
    value: parseEnvInt(env.CPI_BASELINE_VALUE),
  },
  transferInAddressExpirationHours: 24,
  sidechainAddressesForReserves: parseEnvList(env.RAMPS_ULX_ADDRESS_PATHS_FOR_RESERVES).map(
    readAddress,
  ),
  neuteredHDWalletsForReserves: parseEnvList(env.RAMPS_RESERVES_NEUTERED_WALLET_KEYS).map(
    readNeuteredHDWallet,
  ),
  neuteredHDWalletsForSales: parseEnvList(env.RAMPS_SALES_NEUTERED_WALLET_KEYS).map(
    readNeuteredHDWallet,
  ),
  ethereumApis: {
    contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // mainstead address
    alchemyApiToken: env.ALCHEMY_API_TOKEN,
    etherscanApiToken: env.ETHERSCAN_API_TOKEN,
    infuraApiKey: env.INFURA_API_KEY,
    pocketApplicationId: env.POCKET_APPLICATION_ID,
    pocketApplicationSecret: env.POCKET_APPLICATION_SECRET,
    ankrApiKey: env.ANKR_API_KEY,
  } as IEthereumProviderConfig,
};
export default settings;

function replacePRNG(envvar: string): string {
  if (!envvar?.includes('<PRNG>')) return envvar;
  return envvar.replace('<PRNG>', prng);
}

function readAddress(address: string | any): Address {
  if (typeof address === 'string') {
    return Address.readFromPath(address, __dirname);
  }
  return Address.fromStored(address);
}

function readNeuteredHDWallet(neuteredPath: string): EthereumHDWallet<any> {
  if (!neuteredPath) return null;
  return EthereumHDWallet.loadNeutered(neuteredPath);
}
