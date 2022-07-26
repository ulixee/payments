import PgClient from '../lib/PgClient';
import { DbType } from '../lib/PgPool';
import { ISecurityRecord } from './Security';

export default class SecurityMainchainBlock {
  public data: ISecurityMainchainBlockRecord;

  constructor(readonly client: PgClient<DbType.Default>, data?: ISecurityMainchainBlockRecord) {
    this.data = data;
  }

  public static async findSecuritiesNotInChain(
    client: PgClient<DbType.Default>,
    blockHashes: Buffer[],
  ): Promise<ISecurityRecord[]> {
    if (!blockHashes.length) return [];
    const params = blockHashes.map((entry, i) => `$${i + 1}`).join(',');
    return await client.list(
      `
  select * from securities s 
  where is_to_sidechain = false 
    and confirmed_block_height is null
   and not exists 
    (
      select * from security_mainchain_blocks smb 
      where smb.transaction_hash = s.transaction_hash
        and smb.block_hash in (${params})
    )
  `,
      blockHashes,
    );
  }

  public static async record(
    client: PgClient<DbType.Default>,
    block: ISecurityMainchainBlockRecord,
  ): Promise<void> {
    await client.insert<ISecurityMainchainBlockRecord>('security_mainchain_blocks', block, true);
  }

  public static async getRecordedBlocks(
    client: PgClient<DbType.Default>,
    transactionHash: Buffer,
  ): Promise<ISecurityMainchainBlockRecord[]> {
    return await client.list<ISecurityMainchainBlockRecord>(
      'select * from security_mainchain_blocks where transaction_hash = $1',
      [transactionHash],
    );
  }
}

export interface ISecurityMainchainBlockRecord {
  transactionHash: Buffer;
  blockHash: Buffer;
  blockHeight: number;
  blockStableLedgerIndex: number;
}
