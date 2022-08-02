import './setup';
import Identity from '@ulixee/crypto/lib/Identity';
import Address from '@ulixee/crypto/lib/Address';
import * as Path from 'path';
import { PoolConfig } from 'pg';
import { encodeBuffer } from '@ulixee/commons/lib/bufferUtils';
import config = require('config');
import { InvalidParameterError } from '../utils/errors';
import * as vars from './custom-environment-variables';
import * as defaultConfig from './default';

function toList(list): any[] {
  if (typeof list === 'string') {
    return list.split(',').map(x => x.trim());
  }
  return list;
}

function readAddress(address: string | any): Address {
  if (typeof address === 'string') {
    return Address.readFromPath(address, __dirname);
  }
  return Address.fromStored(address);
}

const rootIdentity = config.has('rootIdentityPath')
  ? Identity.loadFromFile(Path.resolve(__dirname, config.get('rootIdentityPath')))
  : Identity.loadFromPem(config.get('rootIdentitySecretKey'));

const settings = {
  port: config.get('port') as number,
  db: config.get('db') as PoolConfig,
  micronoteBatch: {
    minimumFundingCentagons: config.get('micronoteBatch.minimumFundingCentagons'),
    openMinutes: config.get('micronoteBatch.openMinutes'),
    stopNewNotesMinsBeforeClose: config.get('micronoteBatch.stopNewNotesMinsBeforeClose'),
    minimumOpen: config.get('micronoteBatch.minimumOpen'),
    settlementFeeMicrogons: config.get('micronoteBatch.settlementFeeMicrogons'),
    payoutAddress: config.has('micronoteBatch.payoutAddress')
      ? config.get('micronoteBatch.payoutAddress')
      : null,
    prefix: config.get('micronoteBatch.prefix'),
  },
  mainchain: {
    host: config.get('mainchain.host'),
    fundingHoldBlocks: config.get('mainchain.fundingHoldBlocks'),
    stableHeight: 10,
    addresses: toList(config.get('mainchain.addresses') as any[]).map(readAddress),
    addressesByBech32: {} as { [bech32: string]: Address },
  },
  rootIdentity,
  stakeAddress: readAddress(config.get('stakeAddress')),
  stakeSettings: {
    refundBlockWindow: 8 * 6, // 8 hours worth of blocks
    currentCentagons: 600600n, // phase 1 stake
  },
  nullAddress: encodeBuffer(Buffer.from(Array(32).fill(0)), 'ar'),
};

if (!settings.mainchain.addresses.length) {
  throw new InvalidParameterError('No mainchain addresses found to monitor', 'MAINCHAIN_ADDRESSES');
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

if (!defaultConfig || !vars) {
  throw new InvalidParameterError('Did not copy over variables', 'default/custom-env-vars');
}

export default settings;
