import { IMainchainApiTypes } from '@ulixee/specification/mainchain';
import { ITransaction, LedgerType } from '@ulixee/specification';

export default interface IWalletApiService {
  transfer(
    ledger: LedgerType,
    transaction: ITransaction,
  ): Promise<IMainchainApiTypes['Transaction.transfer']['result']>;
  purchase(
    transaction: ITransaction,
  ): Promise<IMainchainApiTypes['Transaction.purchase']['result']>;
  claimCoinage(
    transaction: ITransaction,
  ): Promise<IMainchainApiTypes['Transaction.claim']['result']>;
  checkForBondRedemption(
    transactionHash: Buffer,
  ): Promise<IMainchainApiTypes['Transaction.checkForBondRedemption']['result']>;
  getBlockSettings(blockHeight?: number): Promise<IMainchainApiTypes['Block.settings']['result']>;
  getBlocks(
    blockHeights: number[],
    blockHashes: Buffer[],
  ): Promise<IMainchainApiTypes['Block.getMany']['result']>;
  findWithTransaction(
    transactionHash: Buffer,
    ledgerType: LedgerType,
  ): Promise<IMainchainApiTypes['Block.findWithTransaction']['result']>;
}
