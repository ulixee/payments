import './setup';
import Keypair from '@ulixee/crypto/lib/Keypair';
import Keyring from '@ulixee/crypto/lib/Keyring';
import * as Path from 'path';
import { PoolConfig } from 'pg';
import { encodeHash } from '@ulixee/commons/lib/hashUtils';
import config = require('config');
import { InvalidParameterError } from '../lib/errors';
import * as vars from './custom-environment-variables';
import * as defaultConfig from './default';

function toList(list): any[] {
  if (typeof list === 'string') {
    return list.split(',').map(x => x.trim());
  }
  return list;
}

function readKeyring(keyring: string | any): Keyring {
  if (typeof keyring === 'string') {
    return Keyring.readFromPath(keyring, __dirname);
  }
  return Keyring.fromStored(keyring);
}

const rootKey = config.has('rootKeyPath')
  ? Keypair.loadFromFile(Path.resolve(__dirname, config.get('rootKeyPath')))
  : Keypair.loadFromPem(config.get('rootPrivateKey'));

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
    wallets: toList(config.get('mainchain.wallets') as any[]).map(readKeyring),
  },
  rootKey,
  stakeWallet: readKeyring(config.get('stakeWallet')),
  stakeSettings: {
    refundBlockWindow: 8 * 6, // 8 hours worth of blocks
    currentCentagons: 600600n, // phase 1 stake
  },
  nullAddress: encodeHash(Buffer.from(Array(32).fill(0)), 'ar'),
};

if (!settings.mainchain.wallets.length) {
  throw new InvalidParameterError('No mainchain wallets found to monitor', 'MAINCHAIN_WALLETS');
}

if (!settings.stakeWallet.address) {
  throw new InvalidParameterError('No stake address provided', 'STAKE_WALLET');
}

if (!settings.rootKey) {
  throw new InvalidParameterError('No mainchain approved root key configured', 'ROOT_PRIVATE_KEY');
}

// payout the default address if we didn't specify another
if (!settings.micronoteBatch.payoutAddress) {
  settings.micronoteBatch.payoutAddress = settings.mainchain.wallets[0].address;
}

if (
  settings.mainchain.wallets.find(
    x =>
      x.address === settings.stakeWallet.address ||
      x.transferKeys.some(y => y.publicKey.equals(settings.rootKey.publicKey)) ||
      x.claimKeys.some(y => y.publicKey.equals(settings.rootKey.publicKey)),
  )
) {
  throw new InvalidParameterError(
    'The root public key cannot be used in a transfer-in or stake keyring',
    'rootPublicKey',
  );
}

if (!defaultConfig || !vars) {
  throw new InvalidParameterError('Did not copy over variables', 'default/custom-env-vars');
}

export default settings;
