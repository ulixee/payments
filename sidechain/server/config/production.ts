import ISettings from './ISettings';

module.exports = <ISettings>{
  micronoteBatch: {
    stopNewNotesMinsBeforeClose: 60,
    openMinutes: 60 * 8,
    payoutAddress: null,
  },
  mainchain: {
    host: null,
    wallets: [],
  },
  stakeWallet: null, // must be injected
  rootPrivateKey: null,
};
