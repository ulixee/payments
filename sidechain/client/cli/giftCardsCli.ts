import { Command } from 'commander';
import Identity from '@ulixee/crypto/lib/Identity';
import SidechainClient from '../lib/SidechainClient';
import { sidechainHostOption } from './common';
import ArgonUtils from '../lib/ArgonUtils';

export async function createGiftCard(options: {
  amount: string;
  identityPath: string;
  host?: string;
}): Promise<{ giftCardId: string; redemptionKey: string }> {
  const { identityPath, host, amount } = options;
  const identity = Identity.loadFromFile(identityPath);

  const client = new SidechainClient(host, { identity });
  const microgons = ArgonUtils.parseUnits(amount, 'microgons');

  const giftCard = await client.giftCards.create(microgons);
  // eslint-disable-next-line no-console
  console.log(
    `A developer can use this gift card by running: 
        
"npx @ulixee/sidechain gift-card store ${giftCard.giftCardId}:${giftCard.redemptionKey}"
`,
  );
  return giftCard;
}

export default function giftCardsCli(): Command {
  const cli = new Command('gift-card');

  cli
    .command('create')
    .requiredOption(
      '-m, --amount <value>',
      'The value of this gift card. Amount can postfix "c" for centagons (eg, 50c) or "m" for microgons (5000000m).',
      /\d+[mc]?/,
    )
    .addOption(sidechainHostOption)
    .description('Create a gift card redeemable for various Ulixee tools.')
    .action(async opts => {
      await createGiftCard(opts);
    });

  cli
    .command('store <giftCardIdAndKey>')
    .description('Store a gift card created to try out Ulixee tooling.')
    .addOption(sidechainHostOption)
    .action(async (giftCardIdAndKey, { host }) => {
      const client = new SidechainClient(host, {});
      const [giftCardId, giftCardRedemptionKey] = giftCardIdAndKey.split(':');
      const giftCard = await client.giftCards.store(giftCardId, giftCardRedemptionKey);
      const amount = ArgonUtils.format(giftCard.microgonsRemaining, 'microgons');
      // eslint-disable-next-line no-console
      console.log(
        `You've installed a gift card worth ${amount} that can be spent with the following gift card Issuers: (${giftCard.issuerIdentities.join(
          ', ',
        )}).`,
      );
    });

  cli
    .command('balances')
    .description('Check gift card balance(s).')
    .option('-g --gift-card-id <id>')
    .addOption(sidechainHostOption)
    .action(async ({ host, giftCardId }) => {
      const client = new SidechainClient(host, {});

      if (giftCardId) {
        const card = await client.giftCards.get(giftCardId);
        // eslint-disable-next-line no-console
        console.log(
          `This gift card has ${ArgonUtils.format(
            card.balance,
            'microgons',
          )} redeemable with gift card Issuers: ${card.issuerIdentities.toString()}`,
        );
        return;
      }

      const giftCardBalances = await client.giftCards.getStored();
      const fundPrintouts = Object.values(giftCardBalances).map(card => {
        const amount = ArgonUtils.format(card.microgonsRemaining, 'microgons');
        return ` - [#${
          card.giftCardId
        }]: ${amount} redeemable with gift card Issuers: (${card.issuerIdentities.toString()})`;
      });
      // eslint-disable-next-line no-console
      console.log(
        `You have the following remaining gift card balances\n`,
        fundPrintouts.join('\n'),
      );
    });

  return cli;
}
