import { Command } from 'commander';
import Address from '@ulixee/crypto/lib/Address';
import SidechainClient from '../lib/SidechainClient';
import { commonOptions } from './common';

export default function giftCardsCli(): Command {
  const cli = new Command('gift-card');

  const { sidechainHostOption } = commonOptions(cli);

  cli
    .command('create <microgons>')
    .addOption(sidechainHostOption)
    .option(
      '-a, --address <path>',
      'A path to a Ulixee Address that you wish to use for this Gift Card. It must be configured on your Databox as well. (NOTE: create an Address using "@ulixee/crypto address").',
    )
    .description('Create a gift card for a developer to try out your Databox.')
    .action(async (microgons, { host, address }) => {
      const client = new SidechainClient(host, { address });
      const giftCard = await client.createGiftCard(microgons);
      // eslint-disable-next-line no-console
      console.log(
        `A developer can claim this gift card by running: "@ulixee/sidechain gift-card claim ${giftCard.batchSlug} ${giftCard.giftCardId}"`,
      );
    });

  cli
    .command('claim <batchSlug> <giftCardId>')
    .description('Claim a gift card created by a Developer to try out their Databox.')
    .requiredOption(
      '-a, --address <path>',
      'A path to a Ulixee Address you\'d like to add this gift card to. (NOTE: create an Address using "@ulixee/crypto address")',
    )
    .addOption(sidechainHostOption)
    .action(async (batchSlug, giftCardId, { host, path: addressPath }) => {
      const address = Address.readFromPath(addressPath, process.cwd());
      const client = new SidechainClient(host, { address });
      const fund = await client.claimGiftCard(giftCardId, batchSlug);
      // eslint-disable-next-line no-console
      console.log(
        `You've claimed a gift card worth ${
          fund.microgonsRemaining
        }m that can be spent on the following Gift Card Addresses (${fund.allowedRecipientAddresses.join(
          ', ',
        )}).`,
      );
    });

  return cli;
}
