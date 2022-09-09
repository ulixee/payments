import { Contract, getDefaultProvider, providers, Signer, utils, Wallet } from 'ethers';
import { hexZeroPad, parseUnits } from 'ethers/lib/utils';
import { IBlockchain, USDCNetworks } from './USDCNetworks';
import EthereumHDWallet from './EthereumHDWallet';
import config from '../config';

export default class USDCApi<T extends IBlockchain> {
  contract: Contract;
  provider: providers.BaseProvider;
  signer: Signer;

  constructor(
    blockchain: T,
    network: typeof USDCNetworks[T]['mainnet'] | typeof USDCNetworks[T]['testnet'],
    wallet?: Wallet,
    provider?: providers.BaseProvider,
  ) {
    const options = config.ethereumApis;
    this.provider =
      provider ??
      getDefaultProvider(network, {
        alchemy: options.alchemyApiToken,
        etherscan: options.etherscanApiToken,
        infura: options.infuraApiKey,
        pocket: {
          applicationId: options.pocketApplicationId,
          applicationSecretKey: options.pocketApplicationSecret,
        },
        ankr: options.ankrApiKey,
      });
    if (wallet) {
      this.signer = wallet.connect(this.provider);
    }
    this.contract = new Contract(
      options.contractAddress,
      [
        // Read-Only Functions
        'function balanceOf(address owner) view returns (uint256)',
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)',

        // Authenticated Functions
        'function transfer(address to, uint amount) returns (bool)',

        // Events
        'event Transfer(address indexed from, address indexed to, uint256 amount)',
      ],
      this.signer ?? this.provider,
    );
  }

  async currentBlockNumber(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  async getConfirmations(
    transactionHash: string,
  ): Promise<{ blockNumber: number; blockHash: string; confirmations: number }> {
    return await this.provider.getTransactionReceipt(transactionHash);
  }

  async getBalanceOf(address: string): Promise<bigint> {
    const result = await this.contract.balanceOf(address);
    return BigInt(result.toString());
  }

  async transfer(
    toAddress: string,
    usdc: number,
  ): Promise<{ transactionHash: string; blockNumber: number; blockHash: string; gasUsed: bigint }> {
    const tx = await this.contract.transfer(toAddress, parseUnits(String(usdc), 6));
    const receipt = await tx.wait();
    return {
      transactionHash: tx.hash,
      blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber,
      gasUsed: BigInt(receipt.gasUsed.toString()),
    };
  }

  async findTransfersToAddresses(
    toAddresses: string[],
    startBlocksAgo: number,
  ): Promise<ITransfer[]> {
    if (toAddresses.length > 1000) {
      throw new Error(
        'Filters have a max size. This LIKELY exceeds it, so crapping this out for you... ;)',
      );
    }

    const filterTo = {
      address: this.contract.address,
      topics: [
        utils.id('Transfer(address,address,uint256)'),
        null,
        toAddresses.map(x => hexZeroPad(x, 32)),
      ],
    };

    const transfers = await this.contract.queryFilter(filterTo, startBlocksAgo, 'latest');
    return transfers.map(transfer => {
      const { args, blockHash, blockNumber, transactionHash, address } = transfer;
      const { from, amount, to } = args;
      return {
        fromAddress: from,
        toAddress: to,
        usdc: BigInt(amount.toString()),
        transactionHash,
        blockHash,
        blockNumber,
        contractAddress: address,
      };
    });
  }

  static fromWallet<T extends IBlockchain>(
    wallet: EthereumHDWallet<T>,
    provider?: providers.BaseProvider,
  ): USDCApi<T> {
    const meta = wallet.meta;
    return new USDCApi<T>(meta.blockchain, meta.blockchainNetwork, wallet.wallet, provider);
  }
}

export interface ITransfer {
  transactionHash: string;
  blockNumber: number;
  blockHash: string;
  usdc: bigint;
  contractAddress: string;
  fromAddress: string;
  toAddress: string;
}

export interface IEthereumProviderConfig {
  contractAddress: string;
  alchemyApiToken?: string; // Alchemy API Token
  etherscanApiToken?: string; //	Etherscan API Token
  infuraApiKey?: string;
  pocketApplicationId?: string;
  pocketApplicationSecret?: string;
  ankrApiKey?: string;
}
