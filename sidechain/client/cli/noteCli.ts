import { Command } from 'commander';
import Address from '@ulixee/crypto/lib/Address';
import { bufferReplacer } from '@ulixee/commons/lib/bufferUtils';
import SidechainClient from '../lib/SidechainClient';
import { commonOptions } from './common';

export default function noteCli(): Command {
  const cli = new Command('note');

  const { sidechainHostOption, addressPathOption } = commonOptions(cli);

  cli
    .command('note <noteHashHex>')
    .addOption(sidechainHostOption)
    .description('Get the status of a Ulixee Sidechain Note.')
    .action(async (noteHashHex, { host }) => {
      const client = new SidechainClient(host, {});
      const note = await client.getNote(Buffer.from(noteHashHex, 'hex'));
      // eslint-disable-next-line no-console
      console.log(`Note\n${JSON.stringify(note, bufferReplacer, 2)}`);
    });

  cli
    .command('transfer <centagons> <toAddress>')
    .description('Transfer centagons (100 centagons = ~$1) to another address.')
    .addOption(sidechainHostOption)
    .addOption(addressPathOption)
    .action(async (centagons, toAddress, { host, addressPath }) => {
      const address = Address.readFromPath(addressPath, process.cwd());
      const client = new SidechainClient(host, { address });
      const note = await client.transferNote(BigInt(centagons), toAddress);
      // eslint-disable-next-line no-console
      console.log(`Note Created. NoteHash is: "${note.noteHash.toString('hex')}"`);
    });

  return cli;
}
