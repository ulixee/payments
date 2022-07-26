import ISettings from './ISettings';

module.exports = <ISettings>{
  port: 2500,
  db: {
    host: 'localhost',
    database: 'ulx_sidechain',
    port: 5432,
  },
  micronoteBatch: {
    minimumFundingCentagons: 100n,
    openMinutes: 60 * 3,
    stopNewNotesMinsBeforeClose: 15,
    minimumOpen: 1,
    settlementFeeMicrogons: 100,
    prefix: 'ulx_micronote_batch_',
  },
  mainchain: {
    host: '127.0.0.1:3005',
    fundingHoldBlocks: 6,
    wallets: ['../test/assets/keyrings/SidechainWallet1.json'], // must be injected
  },
  rootPrivateKey:
    '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIFJjsJ9eD1H/rnpxkC+54iQV75WB1OrxFK9crVDVHPPN\n-----END PRIVATE KEY-----',
  stakeWallet: '../test/assets/keyrings/SidechainStake.json',
};
