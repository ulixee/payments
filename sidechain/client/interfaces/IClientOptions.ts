import Keyring from '@ulixee/crypto/lib/Keyring';
import SidechainClient from '../lib/SidechainClient';

export default interface IClientOptions {
  keyring?: Keyring;
  keyringPath?: string;
  sidechain?: SidechainClient;
  sidechainUrl?: string;
  paymentsOnramp?: string;
  debug?: boolean;
}
