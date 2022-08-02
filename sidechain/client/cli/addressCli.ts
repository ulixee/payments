import { Command } from 'commander';
import Address from '@ulixee/crypto/lib/Address';
import SidechainClient from '../lib/SidechainClient';
import { commonOptions } from './common';

export default function addressCli(): Command {
  const cli = new Command('address');

  const { sidechainHostOption } = commonOptions(cli);

  cli
    .command('balance <address>')
    .addOption(sidechainHostOption)
    .description('Get the balance associated with an address')
    .action(async (address, { host }) => {
      const client = new SidechainClient(host, {});
      const balance = await client.getBalance(address);
      // eslint-disable-next-line no-console
      console.log(`Balance: ${balance} centagons (100 centagons = ~$1`);
    });

  cli
    .command('register <pathToAddress>')
    .description(
      'Pre-register an address with the Sidechain. Provide a path to an address created via "@ulixee/crypto address".',
    )
    .addOption(sidechainHostOption)
    .action(async (addressPath, { host }) => {
      const address = Address.readFromPath(addressPath, process.cwd());
      const client = new SidechainClient(host, { address });
      await client.register();
    });

  return cli;
}
