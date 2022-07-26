import { nanoid } from 'nanoid';
import ISettings from './ISettings';

module.exports = <ISettings>{
  port: 0,
  micronoteBatch: {
    minimumFundingCentagons: 100n,
    prefix: 'ulx_test_batch_',
  },
  db: {
    database: `ulx_sidechain_test${nanoid(5).toLowerCase().replace(/[-]/g, '_')}`,
  },
  mainchain: {
    wallets: ['../test/assets/keyrings/SidechainWallet1.json'],
  },
  rootKeyPath: '../test/assets/keys/SidechainRootKey.pem',
  stakeWallet: '../test/assets/keyrings/SidechainStake.json',
};
