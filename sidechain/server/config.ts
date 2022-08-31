import Identity from '@ulixee/crypto/lib/Identity';
import Address from '@ulixee/crypto/lib/Address';
import { loadEnv, parseEnvBigint, parseEnvInt, parseEnvList } from '@ulixee/commons/lib/envUtils';
import { nanoid } from 'nanoid';
import moment = require('moment');
import { InvalidParameterError } from './utils/errors';
import EthereumHDWallet from './ramps/lib/EthereumHDWallet';
import { IEthereumProviderConfig } from './ramps/lib/USDCApi';

loadEnv(__dirname);
const env = process.env;

const rootIdentity = env.ROOT_IDENTITY_PATH
  ? Identity.loadFromFile(env.ROOT_IDENTITY_PATH, { relativeToPath: __dirname })
  : Identity.loadFromPem(env.ROOT_IDENTITY_SECRET_KEY);

const baseUrl = env.SIDECHAIN_HOST
  ? new URL(env.SIDECHAIN_HOST)
  : { port: 0, href: 'http://localhost:' };

const prng = nanoid(5).toLowerCase().replace(/[-]/g, '_');

const ethereumApis: IEthereumProviderConfig = {
  contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // mainstead address
  alchemyApiToken: env.ALCHEMY_API_TOKEN,
  etherscanApiToken: env.ETHERSCAN_API_TOKEN,
  infuraApiKey: env.INFURA_API_KEY,
  pocketApplicationId: env.POCKET_APPLICATION_ID,
  pocketApplicationSecret: env.POCKET_APPLICATION_SECRET,
  ankrApiKey: env.ANKR_API_KEY,
};

const settings = {
  port: env.SIDECHAIN_LISTEN_PORT ?? baseUrl.port,
  baseUrl: baseUrl.href,
  db: {
    host: env.PGHOST,
    port: parseEnvInt(env.PGPORT) || undefined,
    user: env.PGUSER,
    password: env.PGPASSWORD,
  },
  cpiBaseline: {
    date: moment(env.CPI_BASELINE_DATE, 'YYYY-MM').format('YYYY-MM-DD'),
    value: parseEnvInt(env.CPI_BASELINE_VALUE),
  },
  mainDatabase: replacePRNG(env.MAIN_DB),
  rootIdentity,
  nullAddress: `ar1${Array(58).fill(0).join('')}`,
  micronoteBatch: {
    openMinutes: parseEnvInt(env.MICRONOTE_BATCH_MINS_OPEN),
    stopNewNotesMinsBeforeClose: parseEnvInt(env.MICRONOTE_BATCH_NEW_NOTE_STOP_MINS),
    payoutAddress: env.MICRONOTE_BATCH_PAYOUT_ADDRESS,
    prefix: replacePRNG(env.MICRONOTE_BATCH_DB_PREFIX),
    minimumFundingCentagons: parseEnvBigint(env.MICRONOTE_BATCH_MIN_FUNDING_CENTAGONS),
    minimumOpen: parseEnvInt(env.MICRONOTE_BATCH_MIN_OPEN),
    settlementFeeMicrogons: parseEnvInt(env.MICRONOTE_BATCH_SETTLEMENT_FEE),
  },
  mainchain: {
    fundingHoldBlocks: parseEnvInt(env.MAINCHAIN_HOLD_BLOCKS),
    addresses: parseEnvList(env.MAINCHAIN_ADDRESSES).map(readAddress),
    addressesByBech32: {} as { [bech32: string]: Address }, // NOTE: populated below
    host: env.MAINCHAIN_HOST,
    stableHeight: 10,
  },
  stakeSettings: {
    refundBlockWindow: 8 * 6, // 8 hours worth of blocks
    currentCentagons: 0n, // X days of expected earnings
  },
  stakeAddress: readAddress(env.STAKE_ADDRESS),
  ramp: {
    database: replacePRNG(env.RAMP_DB),
    transferInAddressExpirationHours: 24,
    sidechainAddressesForReserves: parseEnvList(env.RAMP_ULX_ADDRESS_PATHS_FOR_RESERVES).map(
      readAddress,
    ),
    neuteredHDWalletsForReserves: parseEnvList(env.RAMP_RESERVES_NEUTERED_WALLET_KEYS).map(
      readNeuteredHDWallet,
    ),
    neuteredHDWalletsForSales: parseEnvList(env.RAMP_SALES_NEUTERED_WALLET_KEYS).map(
      readNeuteredHDWallet,
    ),
    ethereumApis,
  },
};
validate();
export default settings;

function validate(): void {
  if (!settings.mainchain.addresses.length) {
    throw new InvalidParameterError(
      'No mainchain addresses found to monitor',
      'MAINCHAIN_ADDRESSES',
    );
  }

  for (const address of settings.mainchain.addresses) {
    settings.mainchain.addressesByBech32[address.bech32] = address;
  }

  if (!settings.stakeAddress.bech32) {
    throw new InvalidParameterError('No stake address provided', 'STAKE_WALLET');
  }

  if (!settings.rootIdentity) {
    throw new InvalidParameterError(
      'No mainchain approved root identity configured',
      'ROOT_IDENTITY',
    );
  }

  // payout the default address if we didn't specify another
  if (!settings.micronoteBatch.payoutAddress) {
    console.warn(
      'Setting Batch Payouts to the Mainchain Root address!! Set env.MICRONOTE_BATCH_PAYOUT_ADDRESS to change',
      settings.mainchain.addresses[0].bech32,
    );
    settings.micronoteBatch.payoutAddress = settings.mainchain.addresses[0].bech32;
  }

  if (
    settings.mainchain.addresses.find(
      x =>
        x.bech32 === settings.stakeAddress.bech32 ||
        x.transferSigners.some(y => y.bech32 === settings.rootIdentity.bech32) ||
        x.claimSigners.some(y => y.bech32 === settings.rootIdentity.bech32),
    )
  ) {
    throw new InvalidParameterError(
      'The root public key cannot be used in a transfer-in or stake address',
      'rootIdentity',
    );
  }
}

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
