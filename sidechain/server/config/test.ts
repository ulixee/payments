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
    addresses: ['../test/assets/addresses/SidechainWallet1.json'],
  },
  rootIdentityPath: '../test/assets/identities/SidechainRootKey.pem',
  stakeAddress: '../test/assets/addresses/SidechainStake.json',
};
