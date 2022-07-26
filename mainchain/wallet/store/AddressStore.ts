import Address from '@ulixee/crypto/lib/Address';

export default class AddressStore {
  constructor(readonly addresses: Address[]) {}

  public get changeAddress(): string {
    return this.addresses[0].bech32;
  }

  public get coinageClaimsAddress(): string {
    return this.addresses[0].bech32;
  }

  public get bondsAddress(): string {
    return this.addresses[0].bech32;
  }

  public getAddress(address: string): Address {
    return this.addresses.find(x => x.bech32 === address);
  }
}
