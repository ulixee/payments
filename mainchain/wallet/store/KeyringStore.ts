import Keyring from '@ulixee/crypto/lib/Keyring';

export default class KeyringStore {
  constructor(readonly addressKeyrings: Keyring[]) {}

  public get changeAddress(): string {
    return this.addressKeyrings[0].address;
  }

  public get coinageClaimsAddress(): string {
    return this.addressKeyrings[0].address;
  }

  public get bondsAddress(): string {
    return this.addressKeyrings[0].address;
  }

  public getKeyring(address: string): Keyring {
    return this.addressKeyrings.find(x => x.address === address);
  }
}
