import { INote, NoteType } from '@ulixee/specification';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import Address from '@ulixee/crypto/lib/Address';
import addNoteSignature from '@ulixee/sidechain/lib/addNoteSignature';
import config from '../../config';
import MicronoteFunds from './MicronoteFunds';
import PgClient from '../../utils/PgClient';
import { DbType } from '../../utils/PgPool';
import { ConflictError } from '../../utils/errors';
import { IMicronoteRecord } from './Micronote';
import { bridgeToMain } from '../index';

type IPartialMicronote = Pick<
  IMicronoteRecord,
  'id' | 'fundsId' | 'clientAddress' | 'microgonsAllocated' | 'createdTime'
>;

export default class MicronoteBatchClose {
  private settlementFeeMicrogons = 0;
  private guaranteeBlockHeight = 0;
  private noteOutputs: INote[] = [];
  private unclaimedNotes: IPartialMicronote[] = [];
  private missingHashes: Buffer[];
  private readonly closeTimestamp: Date;
  private readonly logger: IBoundLog;

  constructor(
    readonly client: PgClient<DbType.Batch>,
    readonly batchAddress: Address,
    readonly batchBalance: bigint,
    readonly noteHashes: Buffer[],
  ) {
    this.closeTimestamp = new Date();
    this.logger = client.logger.createChild(module, { action: 'MicronoteBatch.close' });
  }

  public async run(): Promise<void> {
    const hasRun = await this.hasAlreadyRun();

    if (hasRun === true) {
      return;
    }

    await this.findOrphanedFunding();
    await this.refundUnclaimedNotes();
    await this.verifyMicronoteFundAllocation();
    await this.loadMicronotePayments();
    await this.loadFundingRefunds();

    await this.createSettlementFeeNote();
    await this.createBurnNote();

    await this.saveLedgerOutputs();
  }

  public async hasAlreadyRun(): Promise<boolean> {
    const results = await this.client.list('SELECT * from note_outputs LIMIT 1');
    if (results.length) {
      this.logger.error('The close batch job appears to have already run', {
        records: results.length,
      });
      return true;
    }
    return false;
  }

  private async verifyMicronoteFundAllocation(): Promise<{
    funds: bigint;
    allocated: bigint;
    revenue: bigint;
    settlementFees: number;
    totalRevenue: bigint;
  }> {
    const { funds, allocated } = await this.client.queryOne<{ funds: bigint; allocated: bigint }>(`
    SELECT SUM(microgons) as funds, SUM(microgons_allocated) as allocated 
       FROM micronote_funds`);

    const { revenue } = await this.client.queryOne<{ revenue: bigint }>(`
    SELECT SUM(microgons_earned) as revenue
       FROM micronote_recipients 
       WHERE microgons_earned > 0`);

    const { claims } = await this.client.queryOne<{ claims: bigint }>(`
    SELECT count(1) as claims FROM micronotes 
       WHERE claimed_time is not null`);

    const settlementFees = config.micronoteBatch.settlementFeeMicrogons * Number(claims ?? 0);

    const totalRevenue = BigInt(settlementFees) + BigInt(revenue ?? 0);

    // double check that notes sum to allocated amounts
    if (totalRevenue !== BigInt(allocated ?? 0)) {
      this.logger.error('Total allocated microgons do not match the payouts', {
        funds,
        totalFees: totalRevenue,
      });
      throw new ConflictError('Total batch amounts allocated do NOT match note microgons paid out');
    }
    return {
      funds,
      allocated,
      revenue,
      settlementFees,
      totalRevenue,
    };
  }

  private async createSettlementFeeNote(): Promise<INote> {
    const { claims } = await this.client.queryOne<{ claims: bigint }>(`
    SELECT count(1) as claims FROM micronotes 
       WHERE claimed_time is not null`);

    this.settlementFeeMicrogons =
      config.micronoteBatch.settlementFeeMicrogons * Number(claims || 0);

    // only make a penny if you pass the centagon mark
    const feeCentagons = Math.floor(this.settlementFeeMicrogons / 10e3);
    if (feeCentagons <= 0) {
      return null;
    }
    const settlementFeeNote = this.signLedgerOutputs(
      NoteType.settlementFees,
      config.micronoteBatch.payoutAddress,
      BigInt(feeCentagons),
      this.guaranteeBlockHeight,
    );
    this.noteOutputs.push(settlementFeeNote);
    return settlementFeeNote;
  }

  private async loadMicronotePayments(): Promise<void> {
    const payments = await this.client.list<{
      microgons: bigint;
      toAddress: string;
      guaranteeBlockHeight: number;
    }>(`
      SELECT 
        coalesce(sum(np.microgons_earned), 0) as microgons, 
        np.address as to_address, 
        max(e.guarantee_block_height) as guarantee_block_height
      FROM micronote_recipients np
        JOIN micronotes n on n.id = np.micronote_id
        JOIN micronote_funds e on e.id = n.funds_id
      GROUP BY np.address`);

    // calculate final payment after burn
    for (const record of payments) {
      if (record.guaranteeBlockHeight > this.guaranteeBlockHeight) {
        this.guaranteeBlockHeight = record.guaranteeBlockHeight;
      }
      // take out burnt argons
      const microgonsAfterBurn = Math.floor(Number(record.microgons) * 0.8);
      // only make a penny if you pass the centagon mark
      const centagonsAfterBurn = Math.floor(microgonsAfterBurn / 10e3);
      if (centagonsAfterBurn <= 0) {
        continue;
      }

      const payment = this.signLedgerOutputs(
        NoteType.revenue,
        record.toAddress,
        BigInt(centagonsAfterBurn),
        record.guaranteeBlockHeight,
      );
      this.noteOutputs.push(payment);
    }
  }

  private async loadFundingRefunds(): Promise<void> {
    const refunds = await this.client.list<{
      microgons: bigint;
      toAddress: string;
      guaranteeBlockHeight: number;
    }>(`
     SELECT 
        coalesce(sum(microgons - microgons_allocated), 0)::bigint as microgons, 
        address as to_address, 
        max(guarantee_block_height) as guarantee_block_height
     FROM micronote_funds 
     WHERE microgons > microgons_allocated 
     GROUP BY address`);

    for (const refund of refunds) {
      const centagons = Math.floor(Number(refund.microgons) / 10e3);
      if (centagons > 0) {
        const record = this.signLedgerOutputs(
          NoteType.micronoteBatchRefund,
          refund.toAddress,
          BigInt(centagons),
          refund.guaranteeBlockHeight,
        );
        this.noteOutputs.push(record);
      }
    }
  }

  private async createBurnNote(): Promise<void> {
    const { totalFunding } = await this.client.queryOne<{ totalFunding: bigint }>(`
    SELECT coalesce(sum(microgons), 0)::bigint as total_funding from micronote_funds
    `);

    let payouts = 0n;
    for (const note of this.noteOutputs) {
      payouts += note.centagons;
    }

    const burn = bankerDivide(BigInt(totalFunding), 10000n) - payouts;

    if (burn > 0) {
      // burn the required funds
      const burnNote = this.signLedgerOutputs(
        NoteType.burn,
        config.nullAddress,
        burn,
        this.guaranteeBlockHeight,
      );
      this.noteOutputs.push(burnNote);
    }
  }

  private signLedgerOutputs(
    type: NoteType,
    toAddress: string,
    centagons: bigint,
    guaranteeBlockHeight: number,
  ): INote {
    return addNoteSignature(
      {
        toAddress,
        centagons,
        fromAddress: this.batchAddress.bech32,
        timestamp: this.closeTimestamp,
        guaranteeBlockHeight,
        type,
      },
      this.batchAddress,
    );
  }

  private async findOrphanedFunding(): Promise<void> {
    const { fundingMicrogons } = await this.client.queryOne<{ fundingMicrogons: bigint }>(`
      SELECT coalesce(SUM(microgons), 0)::bigint as funding_microgons 
      FROM micronote_funds`);

    // see if we have the same balance as the ledger
    if (this.batchBalance * 10000n === fundingMicrogons) {
      this.logger.info('Verified ledger balance matches total funding microgons', {
        balance: this.batchBalance,
      });
      return;
    }
    // if not, need to record and refund the transfers
    const batchNoteHashes = this.noteHashes ?? [];

    this.logger.info(
      'Orphaned transactions exist. Searching through all hashes associated with this public key',
      { hashes: batchNoteHashes.length, sessionId: null },
    );

    const params = batchNoteHashes.map((entry, i) => `($${i + 1}::bytea)`).join(',');

    const missingHashes = await this.client.list<{ hash: Buffer }>(
      `
      SELECT t.hash as hash
      FROM (
        values ${params} 
      ) as t(hash)
        LEFT JOIN micronote_funds e on e.note_hash = t.hash
      WHERE e.note_hash is null`,
      batchNoteHashes,
    );

    this.missingHashes = (missingHashes || []).map(x => x.hash);

    this.logger.info('Found the following missing hashes', {
      hashes: this.missingHashes,
    });

    const promises = this.missingHashes.map(async hash => {
      const note = await bridgeToMain.getNote(hash, this.logger);
      await MicronoteFunds.createFromNote(this.client, note);
      // blow up on purpose if we can't get the note back. Something is wrong
    });

    await Promise.all(promises);
  }

  private async refundUnclaimedNotes(): Promise<void> {
    this.unclaimedNotes = await this.client.list(`
      SELECT id, funds_id, client_address, 
        microgons_allocated, created_time
      FROM micronotes 
      WHERE claimed_time is null 
       AND canceled_time is null`);

    await this.client.update(`UPDATE micronotes set canceled_time = now() 
       WHERE claimed_time is null 
        AND canceled_time is null`);

    const promises = this.unclaimedNotes.map(async note => {
      const funding = new MicronoteFunds(this.client, this.batchAddress.bech32, note.clientAddress);
      return await funding.returnHoldTokens(note.fundsId, note.microgonsAllocated);
    });
    await Promise.all(promises);
  }

  private async saveLedgerOutputs(): Promise<INote[]> {
    return await this.client.batchInsert('note_outputs', this.noteOutputs, 100);
  }
}

function bankerDivide(a: bigint, b: bigint): bigint {
  // Make A and B positive
  const aAbs = a > 0n ? a : -a;
  const bAbs = b > 0n ? b : -b;

  let result = aAbs / bAbs;
  const rem = aAbs % bAbs;
  // if remainder > half divisor, should have rounded up instead of down, so add 1
  if (rem * 2n > bAbs) {
    result++;
  } else if (rem * 2n === bAbs) {
    // Add 1 if result is odd to get an even return value
    if (result % 2n === 1n) result++;
  }

  if (a > 0n !== b > 0n) {
    // Either a XOR b is negative, so the result has to be
    // negative as well.
    return -result;
  }
  return result;
}
