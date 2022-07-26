import ISettings from './ISettings';

module.exports = <{ [K in keyof ISettings]: string | { [X in keyof ISettings[K]]: string } }>{
  port: 'PORT',
  db: {
    host: 'DB_HOST',
    database: 'DB_NAME',
    port: 'DB_PORT',
    user: 'DB_USER',
    password: 'DB_PASSWORD',
  },
  micronoteBatch: {
    openMinutes: 'MICRONOTE_BATCH_MINS_OPEN',
    stopNewNotesMinsBeforeClose: 'MICRONOTE_BATCH_NEW_NOTE_STOP_MINS',
    payoutAddress: 'MICRONOTE_BATCH_PAYOUT_ADDRESS',
  },
  mainchain: {
    wallets: 'MAINCHAIN_WALLETS',
    host: 'MAINCHAIN_HOST',
  },
  rootPrivateKey: 'ROOT_PRIVATE_KEY',
  rootKeyPath: 'ROOT_KEY_PATH',
  stakeWallet: 'STAKE_Wallet',
};
