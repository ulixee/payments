import Identity from '@ulixee/crypto/lib/Identity';
import Address from '@ulixee/crypto/lib/Address';
import { loadEnv, parseEnvBigint, parseEnvInt, parseEnvList } from '@ulixee/commons/lib/envUtils';
import { nanoid } from 'nanoid';
import { InvalidParameterError } from '@ulixee/payment-utils//lib/errors';

loadEnv(process.cwd());
loadEnv(__dirname);
const env = process.env;

const rootIdentity = env.ROOT_IDENTITY_PATH
  ? Identity.loadFromFile(env.ROOT_IDENTITY_PATH, { relativeToPath: __dirname })
  : Identity.loadFromPem(env.ROOT_IDENTITY_SECRET_KEY);

const baseUrl = env.SIDECHAIN_HOST
  ? new URL(env.SIDECHAIN_HOST)
  : { port: 0, href: 'http://localhost:' };

const prng = nanoid(5).toLowerCase().replace(/[-]/g, '_');

const settings = {
  port: env.SIDECHAIN_LISTEN_PORT ?? baseUrl.port,
  baseUrl: baseUrl.href,
  db: {
    host: env.PGHOST,
    port: parseEnvInt(env.PGPORT) || undefined,
    user: env.PGUSER,
    password: env.PGPASSWORD,
  },
  mainDatabase: replacePRNG(env.MAIN_DB),
  rootIdentity,
  nullAddress: `ar1${Array(58).fill(0).join('')}`,
  micronoteBatch: {
    prefix: replacePRNG(env.MICRONOTE_BATCH_DB_PREFIX),
    openMinutes: parseEnvInt(env.MICRONOTE_BATCH_MINS_OPEN),
    stopNewNotesMinsBeforeClose: parseEnvInt(env.MICRONOTE_BATCH_NEW_NOTE_STOP_MINS),
    minimumFundingCentagons: parseEnvBigint(env.MICRONOTE_BATCH_MIN_FUNDING_CENTAGONS),
    minimumOpen: parseEnvInt(env.MICRONOTE_BATCH_MIN_OPEN),
    settlementFeePaymentAddress: env.MICRONOTE_BATCH_FEE_PAYOUT_ADDRESS,
    settlementFeeMicrogons: parseEnvInt(env.MICRONOTE_BATCH_SETTLEMENT_FEE),
  },
  mainchain: {
    fundingHoldBlocks: parseEnvInt(env.MAINCHAIN_HOLD_BLOCKS),
    acceptNewGenesisBlocks: true,
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
  if (!settings.micronoteBatch.settlementFeePaymentAddress) {
    console.warn(
      'Setting Batch Payouts to the Mainchain Root address!! Set env.MICRONOTE_BATCH_FEE_PAYOUT_ADDRESS to change',
      settings.mainchain.addresses[0].bech32,
    );
    settings.micronoteBatch.settlementFeePaymentAddress = settings.mainchain.addresses[0].bech32;
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
