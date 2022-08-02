import { Command, Option } from 'commander';

export function commonOptions(cli: Command): {
  sidechainHostOption: Option;
  addressPathOption: Option;
  identityPrivateKeyPathOption: Option;
  identityPrivateKeyPassphraseOption: Option;
} {
  const sidechainHost = cli.createOption(
    '-h, --host <host>',
    'Sidechain server you wish to connect to.',
  );
  sidechainHost.default('https://greased-argon.com', 'The Ulixee sponsored Sidechain.');

  const identityPrivateKeyPath = cli
    .createOption(
      '-i, --identity-path <path>',
      'A path to a Ulixee Identity. Necessary for certain commands.',
    )
    .env('ULX_IDENTITY_PATH');

  const identityPrivateKeyPassphrase = cli
    .createOption(
      '-p, --identity-passphrase <path>',
      'A decryption passphrase to the Ulixee identity (only necessary if specified during key creation).',
    )
    .env('ULX_IDENTITY_PASSPHRASE');

  const addressPath = cli
    .createOption(
      '-a, --address <path>',
      'A path to a Ulixee Address (created using "@ulixee/crypto address").',
    )
    .env('ULX_ADDRESS');

  return { sidechainHostOption: sidechainHost, identityPrivateKeyPassphraseOption: identityPrivateKeyPassphrase, identityPrivateKeyPathOption: identityPrivateKeyPath, addressPathOption: addressPath };
}
