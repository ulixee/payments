import { ITransaction, LedgerType } from '@ulixee/specification';
import IWalletApiService from '@ulixee/wallet/interfaces/IWalletApiService';
import MainchainApiSchema, { IMainchainApiTypes } from '@ulixee/specification/mainchain';
import ConnectionToMainchainCore from './ConnectionToMainchainCore';

export default class MainchainClient implements IWalletApiService {
  private readonly connectionToCore: ConnectionToMainchainCore;

  constructor(coreHost: string) {
    this.connectionToCore = ConnectionToMainchainCore.remote(coreHost);
  }

  public async getBlockSettings(
    blockHeight?: number,
  ): Promise<IMainchainApiTypes['Block.settings']['result']> {
    return await this.runRemote('Block.settings', {
      blockHeight,
    });
  }

  public async getBlocks(
    blockHeights: number[],
    blockHashes: Buffer[],
  ): Promise<IMainchainApiTypes['Block.getMany']['result']> {
    return await this.runRemote('Block.getMany', {
      blockHeights,
      blockHashes,
    });
  }

  public async getBlockHeader(
    hash: Buffer,
    includeFork = true,
  ): Promise<IMainchainApiTypes['BlockHeader.get']['result']> {
    return await this.runRemote('BlockHeader.get', {
      hash,
      includeFork,
    });
  }

  public async transfer(
    ledger: LedgerType,
    transaction: ITransaction,
  ): Promise<IMainchainApiTypes['Transaction.transfer']['result']> {
    return await this.runRemote('Transaction.transfer', {
      ledger,
      transaction,
    });
  }

  public async createClaim(
    transaction: ITransaction,
  ): Promise<IMainchainApiTypes['Transaction.claim']['result']> {
    return await this.runRemote('Transaction.claim', {
      transaction,
    });
  }

  public async checkForBondRedemption(
    transactionHash: Buffer,
  ): Promise<IMainchainApiTypes['Transaction.checkForBondRedemption']['result']> {
    return await this.runRemote('Transaction.checkForBondRedemption', {
      transactionHash,
    });
  }

  public async claimCoinage(
    transaction: ITransaction,
  ): Promise<IMainchainApiTypes['Transaction.claim']['result']> {
    return await this.createClaim(transaction);
  }

  public async findWithTransaction(
    transactionHash: Buffer,
    ledgerType: LedgerType,
  ): Promise<IMainchainApiTypes['Block.findWithTransaction']['result']> {
    return await this.runRemote('Block.findWithTransaction', {
      transactionHash,
      ledgerType,
    });
  }

  public async purchase(
    transaction: ITransaction,
  ): Promise<IMainchainApiTypes['Transaction.purchase']['result']> {
    return await this.runRemote('Transaction.purchase', {
      transaction,
    });
  }

  protected async runRemote<T extends keyof IMainchainApiTypes>(
    command: T,
    args: IMainchainApiTypes[T]['args'],
  ): Promise<IMainchainApiTypes[T]['result']> {
    await MainchainApiSchema[command].args.parseAsync(args);
    return await this.connectionToCore.sendRequest({ command, args: [args] as any });
  }
}
