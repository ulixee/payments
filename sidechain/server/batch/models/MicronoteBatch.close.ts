import { INote, NoteType } from '@ulixee/specification';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import Address from '@ulixee/crypto/lib/Address';
import addNoteSignature from '@ulixee/sidechain/lib/addNoteSignature';
import ArgonUtils from '@ulixee/sidechain/lib/ArgonUtils';
import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';
import { ConflictError } from '@ulixee/payment-utils/lib/errors';
import MicronoteFunds from './MicronoteFunds';
import config from '../../config';
import Micronote from './Micronote';
import { bridgeToMain } from '../index';
import { BridgeToMain } from '../../bridges';

export default class MicronoteBatchClose {
  private settlementFeeMicrogons = 0;
  private guaranteeBlockHeight = 0;
  private noteOutputs: INote[] = [];
  private unfinalizedMicronoteIds: string[] = [];
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
    await this.refundMicronoteChange();
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
    const { funds, allocated: allocatedFunds } = await this.client.queryOne<{
      funds: bigint;
      allocated: bigint;
    }>(`
    SELECT SUM(microgons) as funds, SUM(microgons_allocated) as allocated 
       FROM micronote_funds`);

    const { revenue } = await this.client.queryOne<{ revenue: bigint }>(`
    SELECT SUM(microgons_earned) as revenue
       FROM micronote_disbursements 
       WHERE microgons_earned > 0`);

    const { claims } = await this.client.queryOne<{ claims: bigint }>(`
    SELECT count(1) as claims FROM micronotes`);

    const settlementFees = config.micronoteBatch.settlementFeeMicrogons * Number(claims ?? 0);

    const distributionsAndFees = BigInt(settlementFees) + BigInt(revenue ?? 0);

    // double check that notes sum to allocated amounts
    if (distributionsAndFees !== BigInt(allocatedFunds ?? 0)) {
      this.logger.error('Total allocated microgons do not match the payouts', {
        funds,
        allocatedFunds,
        distributionsAndFees,
      });
      throw new ConflictError('Total batch amounts allocated do NOT match note microgons paid out');
    }
    return {
      funds,
      allocated: allocatedFunds,
      revenue,
      settlementFees,
      totalRevenue: distributionsAndFees,
    };
  }

  private async createSettlementFeeNote(): Promise<INote> {
    const { claims } = await this.client.queryOne<{ claims: bigint }>(
      `SELECT count(1) as claims FROM micronotes`,
    );

    this.settlementFeeMicrogons =
      config.micronoteBatch.settlementFeeMicrogons * Number(claims || 0);

    // only make a penny if you pass the centagon mark
    const feeCentagons = ArgonUtils.microgonsToCentagons(this.settlementFeeMicrogons);
    if (feeCentagons <= 0) {
      return null;
    }
    const settlementFeeNote = this.signLedgerOutputs(
      NoteType.settlementFees,
      config.micronoteBatch.settlementFeePaymentAddress,
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
      FROM micronote_disbursements np
        JOIN micronotes n on n.id = np.micronote_id
        JOIN micronote_funds e on e.id = n.funds_id
      GROUP BY np.address`);

    const blockSettings = await BridgeToMain.blockSettings();
    const unburnedFundsPercent = (100 - blockSettings.minimumMicronoteBurnPercent) / 100;
    // calculate final payment after burn
    for (const record of payments) {
      if (record.guaranteeBlockHeight > this.guaranteeBlockHeight) {
        this.guaranteeBlockHeight = record.guaranteeBlockHeight;
      }
      // take out burnt argons (NOTE: BigInt floors, microgons / 1e4 = centagons)
      const centagonsAfterBurn = ArgonUtils.microgonsToCentagons(
        Number(record.microgons) * unburnedFundsPercent,
      );
      if (centagonsAfterBurn <= 0n) {
        continue;
      }

      const payment = this.signLedgerOutputs(
        NoteType.revenue,
        record.toAddress,
        centagonsAfterBurn,
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
      const centagons = ArgonUtils.microgonsToCentagons(refund.microgons);
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

    const burn = bankerDivide(totalFunding, 10000n) - payouts;

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
      const note = await bridgeToMain.getNote(hash, { logger: this.logger });
      await MicronoteFunds.createFromNote(this.client, note);
      // blow up on purpose if we can't get the note back. Something is wrong
    });

    await Promise.all(promises);
  }

  private async refundMicronoteChange(): Promise<void> {
    this.unfinalizedMicronoteIds = (
      await this.client.list<{ id: string }>(`
      SELECT id
      FROM micronotes 
      WHERE finalized_time is null 
       AND canceled_time is null`)
    ).map(x => x.id);

    // might not have any rows to update, so run a regular query
    await this.client.query(`UPDATE micronotes set finalized_time = now() 
       WHERE finalized_time is null 
        AND canceled_time is null`);

    const promises = this.unfinalizedMicronoteIds.map(id =>
      new Micronote(this.client, null, id).returnChange(this.batchAddress.bech32),
    );
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
