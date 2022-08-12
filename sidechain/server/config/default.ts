import ISettings from './ISettings';

module.exports = <ISettings>{
  baseUrl: `http://localhost:2500`,
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
    host: null,
    fundingHoldBlocks: 6,
    addresses: ['../test/assets/addresses/SidechainWallet1.json'], // must be injected
  },
  rootIdentitySecretKey:
    '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIFJjsJ9eD1H/rnpxkC+54iQV75WB1OrxFK9crVDVHPPN\n-----END PRIVATE KEY-----',
  stakeAddress: '../test/assets/addresses/SidechainStake.json',
};
