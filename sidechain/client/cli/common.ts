import { Option } from 'commander';
import env from '../env';

export const sidechainHostOption = new Option(
  '-h, --host <host>',
  'Sidechain server you wish to connect to (if not the default).',
);
sidechainHostOption.default(env.sidechainHost, 'The Ulixee sponsored Sidechain.');

export const identityPrivateKeyPathOption = new Option(
  '-i, --identity-path <path>',
  'A path to a Ulixee Identity. Necessary for certain commands.',
).env('ULX_IDENTITY_PATH');

export const identityPemOption = new Option(
  '-p, --identity-pem <data>',
  'Raw Ulixee Identity PEM',
).env('ULX_IDENTITY_PEM');

export const identityPrivateKeyPassphraseOption = new Option(
  '-p, --identity-passphrase <path>',
  'A decryption passphrase to the Ulixee identity (only necessary if specified during key creation).',
).env('ULX_IDENTITY_PASSPHRASE');

export const addressPathOption = new Option(
  '-a, --address-path <path>',
  'A path to a Ulixee Address (created using "@ulixee/crypto address").',
).env('ULX_ADDRESS');

export function requiredOptionWithEnv(flags: string, description: string, envVar: string): Option {
  const option = new Option(flags, description);
  option.required = true;
  option.mandatory = true;
  option.env(envVar);
  return option;
}
