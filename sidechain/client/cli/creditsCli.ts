import { Command } from 'commander';
import Address from '@ulixee/crypto/lib/Address';
import SidechainClient from '../lib/SidechainClient';
import { commonOptions } from './common';

export default function creditsCli(): Command {
  const cli = new Command('credit');

  const { sidechainHostOption } = commonOptions(cli);

  cli
    .command('create <microgons>')
    .addOption(sidechainHostOption)
    .option(
      '-a, --address <path>',
      'A path to a Ulixee Address that you wish to use for this credit. It must be configured on your Databox as well. (NOTE: create an Address using "@ulixee/crypto address").',
    )
    .description('Create a credit for a developer to try out your Databox.')
    .action(async (microgons, { host, address }) => {
      const client = new SidechainClient(host, { address });
      const credit = await client.createCredit(microgons);
      // eslint-disable-next-line no-console
      console.log(
        `A developer can claim this credit by running: "@ulixee/sidechain credit claim ${credit.batchSlug} ${credit.creditId}"`,
      );
    });

  cli
    .command('claim <batchSlug> <creditId>')
    .description('Claim a credit created by a Developer to try out their Databox.')
    .requiredOption(
      '-a, --address <path>',
      'A path to a Ulixee Address you\'d like to add this credit to. (NOTE: create an Address using "@ulixee/crypto address")',
    )
    .addOption(sidechainHostOption)
    .action(async (batchSlug, creditId, { host, path: addressPath }) => {
      const address = Address.readFromPath(addressPath, process.cwd());
      const client = new SidechainClient(host, { address });
      const fund = await client.claimCredit(creditId, batchSlug);
      // eslint-disable-next-line no-console
      console.log(
        `You've claimed a credit worth ${fund.microgonsRemaining} to can be spent on this developer's Databox (NOTE: credits are restricted to specific Databox Addresses)`,
      );
    });

  return cli;
}
