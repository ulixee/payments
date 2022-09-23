import { ITransaction, NoteType } from '@ulixee/specification';
import { InsufficientFundsError } from '@ulixee/payment-utils/lib/errors';
import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';
import config from '../../config';
import Note from './Note';
import SecurityMainchainBlock, { ISecurityMainchainBlockRecord } from './SecurityMainchainBlock';
import { IMainchainBlockRecord } from './MainchainBlock';

export default class Security {
  public data: ISecurityRecord;

  constructor(readonly client: PgClient<DbType.Main>, data?: ISecurityRecord) {
    this.data = data;
    if (this.data.isBurn === undefined) {
      this.data.isBurn = false;
    }
  }

  public async save(
    block?: Omit<ISecurityMainchainBlockRecord, 'transactionHash'>,
  ): Promise<Security> {
    await this.client.insert<ISecurityRecord>('securities', this.data, true);
    if (block) {
      await SecurityMainchainBlock.record(this.client, {
        ...block,
        transactionHash: this.data.transactionHash,
      });
    }
    return this;
  }

  public static async recordConfirmedHeight(
    client: PgClient<DbType.Main>,
    confirmedHeight: number,
    transactionHash: Buffer,
    transactionOutputIndex: number,
  ): Promise<typeof Security> {
    await client.update(
      `
    update securities set confirmed_block_height = $1 
    where transaction_hash = $2 and transaction_output_index = $3
    `,
      [confirmedHeight, transactionHash, transactionOutputIndex],
    );
    return this;
  }

  public static async lock(
    client: PgClient<DbType.Main>,
    transactionHash: Buffer,
    transactionOutputIndex: number,
  ): Promise<ISecurityRecord> {
    const { rows } = await client.query<ISecurityRecord>(
      `
      select spent_on_transaction_hash 
      from securities 
        where transaction_hash = $1 and transaction_output_index = $2 
      for update 
      skip locked
      limit 1`,
      [transactionHash, transactionOutputIndex],
    );
    return rows ? rows[0] : null;
  }

  public static async find(
    client: PgClient<DbType.Main>,
    transactionHash: Buffer,
  ): Promise<Security[]> {
    const results = await client.list<ISecurityRecord>(
      'select * from securities where transaction_hash = $1',
      [transactionHash],
    );
    return results.map(data => new Security(client, data));
  }

  public static async lockUnspentFunds(
    client: PgClient<DbType.Main>,
    centagons: bigint | number,
  ): Promise<{ outputs: ISecurityRecord[]; change: bigint }> {
    const unspentFunds = await client.list<ISecurityRecord>(
      `
      select * 
      from securities 
      where spent_on_transaction_hash is null 
          and is_to_sidechain = true
          and confirmed_block_height is not null
      order by centagons asc`,
    );
    centagons = BigInt(centagons);
    // spend small change first
    const outputs: ISecurityRecord[] = [];
    let total = 0n;
    for (const unspent of unspentFunds) {
      // lock
      const row = await Security.lock(
        client,
        unspent.transactionHash,
        unspent.transactionOutputIndex,
      );
      if (!row || row.spentOnTransactionHash) {
        continue;
      }
      outputs.push(unspent);
      total += unspent.centagons;
      if (total >= centagons) {
        break;
      }
    }
    if (total < centagons) {
      throw new InsufficientFundsError('Cannot wallet for this many centagons', String(total));
    }
    return {
      outputs,
      change: total - centagons,
    };
  }

  public static async allUnspentFunds(
    client: PgClient<DbType.Main>,
  ): Promise<ISecurityRecord[]> {
    return await client.list<ISecurityRecord>(
      `
      select * 
      from securities 
      where spent_on_transaction_hash is null 
          and is_to_sidechain = true
          and (is_transfer_in = false or confirmed_block_height is not null)
      order by centagons asc`,
    );
  }

  public static async recordSpend(
    client: PgClient<DbType.Main>,
    payouts: (IPayout & {
      outIndex: number;
    })[],
    unspentFunds: ISecurityRecord[],
    transaction: ITransaction,
    sidechainAddress: string,
    hasChange: boolean,
    isBurn = false,
  ): Promise<Security[]> {
    const fundingOut: Security[] = [];
    for (const payout of payouts) {
      const transactionOutput = transaction.outputs[payout.outIndex];
      const fundingTransferOut = await new Security(client, {
        transactionHash: transaction.transactionHash,
        transactionOutputIndex: payout.outIndex,
        transactionOutputAddress: transactionOutput.address,
        centagons: transactionOutput.centagons,
        fromAddress: sidechainAddress,
        toAddress: payout.address,
        isToSidechain: false,
        noteHash: payout.noteHash,
        transactionTime: transaction.time,
        isBurn,
      }).save();
      fundingOut.push(fundingTransferOut);
    }

    if (hasChange) {
      const changeOutput = transaction.outputs[transaction.outputs.length - 1];
      await new Security(client, {
        transactionHash: transaction.transactionHash,
        transactionOutputIndex: transaction.outputs.length - 1,
        transactionOutputAddress: changeOutput.address,
        centagons: changeOutput.centagons,
        fromAddress: sidechainAddress,
        toAddress: sidechainAddress,
        isToSidechain: true,
        transactionTime: transaction.time,
        isBurn: false,
      }).save();
    }

    // mark all the original outputs spent
    for (const output of unspentFunds) {
      await client.update(
        `
        update securities 
          set spent_on_transaction_hash = $1
        where transaction_hash = $2 
          and transaction_output_index = $3`,
        [transaction.transactionHash, output.transactionHash, output.transactionOutputIndex],
      );
    }
    return fundingOut;
  }

  public static async recordConfirmedSecurities(
    client: PgClient<DbType.Main>,
    latestBlockHeight: number,
  ): Promise<void> {
    const unconfirmedSecurities = await client.list<ISecurityRecord>(`
      select * from securities 
      where confirmed_block_height is null
    `);
    for (const security of unconfirmedSecurities) {
      const blocks = await client.list<IMainchainBlockRecord>(
        `
      select mb.* from mainchain_blocks mb 
        join security_mainchain_blocks sb 
          on sb.block_hash = mb.block_hash 
      where sb.transaction_hash = $1 
      `,
        [security.transactionHash],
      );
      // must be on longest chain
      const longestChainBlock = blocks.find(x => x.isLongestChain);
      if (!longestChainBlock) {
        continue;
      }

      // confirmed if all the blocks where transaction exists > funding hold height
      const isConfirmed = blocks.every(x => {
        // if genesis block, no wait on funds
        if (x.height === 0) return true;

        const blockAge = latestBlockHeight - x.height;
        return blockAge >= config.mainchain.fundingHoldBlocks;
      });
      if (isConfirmed === false) continue;

      const blockAge = blocks.reduce((max, entry) => (entry.height > max ? entry.height : max), 0);

      await Security.recordConfirmedHeight(
        client,
        blockAge,
        security.transactionHash,
        security.transactionOutputIndex,
      );

      // if this is a transfer that is now confirmed, create a corresponding note
      if (security.isTransferIn === true && security.noteHash === null) {
        const noteData = await Note.addSignature(
          {
            fromAddress: security.toAddress,
            toAddress: security.fromAddress, // reversed since we're granting tokens
            centagons: security.centagons,
            timestamp: security.transactionTime,
            type: NoteType.transferIn,
          },
          config.mainchain.addressesByBech32[security.toAddress],
        );
        const note = await new Note(client, noteData).saveUnchecked(longestChainBlock.height);

        await client.update(
          `
          update securities set note_hash = $1
            where transaction_hash = $2 
              and transaction_output_index = $3 
          `,
          [note.data.noteHash, security.transactionHash, security.transactionOutputIndex],
        );
      }
    }
  }
}

export interface ISecurityRecord {
  transactionHash: Buffer;
  transactionOutputIndex: number;
  transactionOutputAddress: string;
  transactionTime: Date;
  centagons: bigint;
  fromAddress: string;
  toAddress: string;
  isBurn?: boolean;
  isTransferIn?: boolean;
  isToSidechain: boolean;
  noteHash?: Buffer;
  spentOnTransactionHash?: Buffer;
  confirmedBlockHeight?: number;
}

export interface IPayout {
  centagons: bigint;
  address: string;
  noteHash?: Buffer;
}
