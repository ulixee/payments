import PgClient from '../../utils/PgClient';
import { DbType } from '../../utils/PgPool';
import { IBlockchain } from '../lib/USDCNetworks';
import { ITransfer } from '../lib/USDCApi';
import RampDb from '../db';

export default class USDCTransfer {
  public static table = 'usdc_transfers';
  public data: IUSDCTransfer;

  constructor(readonly client: PgClient<DbType.Ramp>, data?: IUSDCTransfer) {
    this.data = data;
  }

  public async save(): Promise<USDCTransfer> {
    await this.client.insertWithId<IUSDCTransfer>(USDCTransfer.table, this.data);
    return this;
  }

  public static convertDollarsToCentagons(
    dollarsE6: number,
    dollarsToArgonConversionRate: number,
    usdcReservesE6: bigint,
    argonCirculationE6: bigint,
  ): bigint {
    const usdcReservesToArgonsRatio = !argonCirculationE6
      ? 1
      : (dollarsToArgonConversionRate * Number((1000n * usdcReservesE6) / argonCirculationE6)) /
        1000;

    let conversionRate = dollarsToArgonConversionRate;
    // if not deflationary, take smaller of usdcReservesToArgonsRatio and dollarsToArgonConversionRate
    if (usdcReservesToArgonsRatio < conversionRate && dollarsToArgonConversionRate < 1) {
      conversionRate = usdcReservesToArgonsRatio;
    }

    const argons = (dollarsE6 * conversionRate) / 1e6;
    // bigint conversion will floor amount to nearest whole number
    return BigInt(argons * 100);
  }

  public static async onTransferFound(
    client: PgClient<DbType.Ramp>,
    transfer: ITransfer,
    blockchain: IBlockchain,
    blockchainNetwork: string,
    toUsdcAddressId: number,
    conversionRate: number,
  ): Promise<IUSDCTransfer> {
    const {
      transactionHash,
      toAddress,
      fromAddress,
      usdc,
      blockHash,
      blockNumber,
      contractAddress,
    } = transfer;
    const security: Omit<IUSDCTransfer, 'id'> = {
      blockchain,
      blockchainNetwork,
      contractAddress,
      usdc,
      toUsdcAddress: toAddress,
      fromUsdcAddress: fromAddress,
      toUsdcAddressId,
      blockNumber,
      blockHash,
      transactionHash,
      recordedTime: new Date(),
      argonConversionRate: conversionRate,
    };
    return await client.insertWithId(USDCTransfer.table, security);
  }

  public static findUnconfirmed(): Promise<IUSDCTransfer[]> {
    return RampDb.transaction(client =>
      client.list<IUSDCTransfer>(
        `select * from ${this.table} where confirmed_block_number is null`,
      ),
    );
  }

  public static async recordConfirmation(
    client: PgClient<DbType.Ramp>,
    security: IUSDCTransfer,
    confirmationBlock: {
      blockNumber: number;
      blockHash: string;
      confirmations: number;
    },
    noteHash: Buffer,
  ): Promise<boolean> {
    const { blockNumber, blockHash, confirmations } = confirmationBlock;
    security.noteHash = noteHash;
    security.blockNumber = blockNumber;
    security.blockHash = blockHash;
    security.confirmedTime = new Date();
    security.confirmedBlockNumber = blockNumber + confirmations;
    return await client.update(
      `update ${this.table} set note_hash=$2, confirmed_block_number=$3, confirmed_time=$4, block_number=$5, block_hash=$6
            where id=$1`,
      [
        security.id,
        security.noteHash,
        security.confirmedBlockNumber,
        security.confirmedTime,
        security.blockNumber,
        security.blockHash,
      ],
    );
  }

  public static async getReservesTransfers(
    client: PgClient<DbType.Ramp>,
    addressIds: number[],
  ): Promise<IUSDCTransfer[]> {
    return await client.list(
      `select * from ${this.table} where
                confirmed_block_number is not null and 
                (from_usdc_address_id = ANY($1) or from_usdc_address_id = ANY($1))`,
      [addressIds],
    );
  }
}

export interface IUSDCTransfer {
  id: number;
  blockchain: IBlockchain;
  blockchainNetwork;
  contractAddress: string;
  transactionHash: string;
  usdc: bigint;
  fromUsdcAddress: string;
  fromUsdcAddressId?: string;
  toUsdcAddress: string;
  toUsdcAddressId?: number;
  recordedTime: Date;
  argonConversionRate: number;
  blockNumber: number;
  blockHash: string;
  noteHash?: Buffer;
  confirmedBlockNumber?: number;
  confirmedTime?: Date;
}
