import '@ulixee/commons/lib/SourceMapSupport';
import { Argument, Command } from 'commander'; // eslint-disable-line import/no-extraneous-dependencies
import * as Fs from 'fs';
import * as Path from 'path';
import { readFileAsJson } from '@ulixee/commons/lib/fileUtils';
import moment = require('moment');
import EthereumHDWallet, { IHDWalletJson } from './lib/EthereumHDWallet';
import { USDCNetworks } from './lib/USDCNetworks';
import config from './config';
import RampAudit from './models/RampAudit';

const cli = new Command('Ulixee Ramps Admin CLI');

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
        await Fs.promises.writeFile(
          Path.resolve(process.cwd(), savePath),
          JSON.stringify(walletJson, null, 2),
        );
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

cli
  .command('sign-audits <pathToEthereumWallet>')
  .description('Sign audits to prove custody of Ethereum wallets')
  .option('-p, --password <password>', 'Ethereum wallet file password.')
  .action(async (pathToEthereumWallet, { password }) => {
    // eslint-disable-next-line no-console
    console.log(
      'Looking up audits in environment %s. Db host %s',
      process.env.NODE_ENV,
      config.db.host,
    );
    const file = await readFileAsJson<IHDWalletJson<any>>(Path.resolve(pathToEthereumWallet));
    // TODO: support keeping wallet in MetaMask and signing
    const wallet = await EthereumHDWallet.loadFromEncrypted(file, password);
    const signed = await RampAudit.signAudits(wallet);
    // eslint-disable-next-line no-console
    console.log(
      'Signed audits: %s',
      signed
        .map(x => x.auditDate)
        .map(x => moment(x).format('YYYY-MM-DD'))
        .join(', '),
    );
  });

cli.parseAsync().catch(console.error);
