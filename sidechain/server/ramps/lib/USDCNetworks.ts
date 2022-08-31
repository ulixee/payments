export interface INetworkEnvironments {
  mainnet: string;
  testnet: string;
}

export const USDCNetworks: Record<string, INetworkEnvironments> = {
  ethereum: {
    mainnet: 'homestead',
    // testnet: 'ropsten', // proof-of-work testnet,
    testnet: 'rinkeby', // (proof-of-authority testnet)
  },
  polygon: {
    mainnet: 'matic',
    testnet: 'maticmum',
  },
  // arbitrum: {
  //   mainnet: 'arbitrum',
  //   testnet: 'arbitrum-rinkeby',
  // },
};

export const Confirmations = {
  ethereum: 10,
  polygon: 128,
};

export function getNetwork(blockchain: IBlockchain, isMainnet = false): string {
  return USDCNetworks[blockchain][isMainnet ? 'mainnet' : 'testnet'];
}

export type IBlockchain = keyof typeof USDCNetworks;
