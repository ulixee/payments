import { Command } from 'commander';
import addressCli from './addressCli';
import giftCardsCli from './giftCardsCli';
import noteCli from './noteCli';

const { version } = require('../package.json');

export default function sidechainCommands(): Command {
  const program = new Command().version(version);
  program.addCommand(addressCli());
  program.addCommand(giftCardsCli());
  program.addCommand(noteCli())

  return program;
}
