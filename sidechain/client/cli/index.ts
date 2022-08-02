import { Command } from 'commander';
import addressCli from './addressCli';
import creditsCli from './creditsCli';
import noteCli from './noteCli';

const { version } = require('../package.json');

export default function sidechainCommands(): Command {
  const program = new Command().version(version);
  program.addCommand(addressCli());
  program.addCommand(creditsCli());
  program.addCommand(noteCli())

  return program;
}
