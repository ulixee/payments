import '@ulixee/commons/lib/SourceMapSupport';
import { Argument, Command } from 'commander'; // eslint-disable-line import/no-extraneous-dependencies
import * as Fs from 'fs';
import * as Path from 'path';
import EthereumHDWallet from './ramps/lib/EthereumHDWallet';
import { USDCNetworks } from './ramps/lib/USDCNetworks';

const cli = new Command('Sidechain Admin CLI');

cli
  .command('create-hd-wallet')
  .description('Create a Hierarchical Deterministic Wallet on a given blockchain.')
  .addArgument(
    (() => {
      const arg = new Argument('<blockchain>', 'The blockchain for which to allocate this Wallet.');
      arg.argOptional();
      arg.choices(Object.keys(USDCNetworks));
      arg.default('ethereum');
      return arg;
    })(),
  )
  .option('-t, --testnet', 'Is this a testnet wallet?', false)
  .option('-s, --save-path <path>', 'Output the encrypted keys to the given path')
  .requiredOption('-p, --password <password>', 'Encrypt the file contents with a password')
  .action(async (blockchain, { testnet, savePath, password }) => {
    const blockchainNetwork = USDCNetworks[blockchain][testnet ? 'testnet' : 'mainnet'];
    const wallet = EthereumHDWallet.create({ blockchain, blockchainNetwork });
    if (password) {
      const walletJson = await wallet.exportFull(password);
      if (savePath) {
        // eslint-disable-next-line no-console
        console.log('Writing HD Wallet to %s', Path.resolve(process.cwd(), savePath));
        await Fs.promises.writeFile(Path.resolve(process.cwd(), savePath), JSON.stringify(walletJson, null, 2));
      } else {
        // eslint-disable-next-line no-console
        console.log(`
### RAW HD WALLET CONTENTS ####
-------------------------------
      
${JSON.stringify(walletJson)}

-------------------------------
`);
      }
    }

    const neutered = wallet.exportNeuteredKey();
    // eslint-disable-next-line no-console
    console.log(`
### NEUTERED WALLET (SAFE TO DEPLOY) ####
-------------------------------
      
${neutered}

-------------------------------
`);
  });


cli.parseAsync().catch(console.error);
