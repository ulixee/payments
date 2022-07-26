import Address from '@ulixee/crypto/lib/Address';
import SidechainClient from '../lib/SidechainClient';

export default interface IClientOptions {
  address?: Address;
  addressPath?: string;
  sidechain?: SidechainClient;
  sidechainUrl?: string;
  paymentsOnramp?: string;
  debug?: boolean;
}
