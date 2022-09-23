import { Command } from 'commander';
import Address from '@ulixee/crypto/lib/Address';
import SidechainClient from '../lib/SidechainClient';
import { sidechainHostOption, addressPathOption, requiredOptionWithEnv } from './common';
import ArgonUtils from '../lib/ArgonUtils';

export default function giftCardsCli(): Command {
  const cli = new Command('gift-card');

  cli
    .command('create')
    .requiredOption(
      '-m, --amount <value>',
      'The value of this gift card. Amount can postfix "c" for centagons (eg, 50c) or "m" for microgons (5000000m).',
      /\d+[mc]/,
    )
    .addOption(sidechainHostOption)
    .addOption(
      requiredOptionWithEnv(
        addressPathOption.flags,
        'A path to a Ulixee Address that you wish to use for this gift card. It must be configured on your Databox as well. (NOTE: create an Address using "npx @ulixee/crypto address").',
        'ULX_ADDRESS',
      ),
    )
    .description('Create a gift card for a developer to try out your Databox.')
    .action(async ({ amount, host, addressPath }) => {
      const address = Address.readFromPath(addressPath);
      const client = new SidechainClient(host, { address });
      const microgons = ArgonUtils.parseUnits(amount, 'microgons');
      const giftCard = await client.createGiftCard(microgons);
      // eslint-disable-next-line no-console
      console.log(
        `A developer can claim this gift card by running: "npx @ulixee/sidechain gift-card claim ${giftCard.batchSlug} ${giftCard.giftCardId}"`,
      );
    });

  cli
    .command('claim <batchSlug> <giftCardId>')
    .description('Claim a gift card created by a Developer to try out their Databox.')
    .addOption(
      requiredOptionWithEnv(
        addressPathOption.flags,
        `A path to a Ulixee Address you'd like to add this gift card to. (NOTE: create an Address using "npx @ulixee/crypto address")`,
        'ULX_ADDRESS',
      ),
    )
    .addOption(sidechainHostOption)
    .action(async (batchSlug, giftCardId, { host, addressPath }) => {
      const address = Address.readFromPath(addressPath, process.cwd());
      const client = new SidechainClient(host, { address });
      const fund = await client.claimGiftCard(giftCardId, batchSlug);
      const amount = ArgonUtils.format(fund.microgonsRemaining, 'microgons');
      // eslint-disable-next-line no-console
      console.log(
        `You've claimed a gift card worth ${amount} that can be spent on the following Gift Card Addresses (${fund.allowedRecipientAddresses.join(
          ', ',
        )}).`,
      );
    });

  cli
    .command('balances')
    .description('Check balances of any gift cards you have.')
    .addOption(
      requiredOptionWithEnv(
        addressPathOption.flags,
        `Your Ulixee Address associated with these gift cards`,
        'ULX_ADDRESS',
      ),
    )
    .addOption(sidechainHostOption)
    .action(async ({ host, addressPath }) => {
      const address = Address.readFromPath(addressPath, process.cwd());
      const client = new SidechainClient(host, { address });
      const { giftCard } = await client.micronoteBatchFunding.getActiveBatches();
      const funds = await client.micronoteBatchFunding.getActiveFunds(giftCard);
      const fundPrintouts = funds.map(fund => {
        const amount = ArgonUtils.format(fund.microgonsRemaining, 'microgons');
        return ` - [#${
          fund.fundsId
        }]: ${amount} redeemable with addresses (${fund.allowedRecipientAddresses.toString()})`;
      });
      // eslint-disable-next-line no-console
      console.log(
        `You have the following remaining gift card balances\n`,
        fundPrintouts.join('\n'),
      );
    });

  return cli;
}
