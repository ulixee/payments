import { NoteType } from '@ulixee/specification';
import IMicronoteBatch from '@ulixee/specification/types/IMicronoteBatch';
import { ISidechainApiTypes } from '@ulixee/specification/sidechain';
import Resolvable from '@ulixee/commons/lib/Resolvable';
import Queue from '@ulixee/commons/lib/Queue';
import Identity from '@ulixee/crypto/lib/Identity';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { InvalidSignatureError } from '@ulixee/crypto/lib/errors';
import SidechainClient from './SidechainClient';
import { NeedsSidechainBatchFunding } from './errors';

export default class MicronoteBatchFunding {
  public queryFundingToPreload = 100;

  private queue = new Queue();

  private fundsByIdPerBatch: { [batchSlug: string]: { [fundsId: number]: IMicronoteFund } } = {};
  private activeFundsId: number;
  private activeGiftCardFundsPromise: Promise<any>;

  private activeBatchesPromise?: Resolvable<ISidechainApiTypes['MicronoteBatch.get']['result']>;

  constructor(
    readonly client: {
      buildNote: SidechainClient['buildNote'];
      runRemote: SidechainClient['runRemote'];
      address: SidechainClient['address'];
    },
  ) {}

  public async findGiftCardForRecipients(
    microgons: number,
    recipientAddresses: string[],
    batch?: IMicronoteBatch,
  ): Promise<IMicronoteFund> {
    batch ??= (await this.getActiveBatches()).giftCard;
    if (!batch) return null;

    await (this.activeGiftCardFundsPromise ??= this.getActiveFunds(batch));

    recipientAddresses ??= [];
    this.fundsByIdPerBatch[batch.batchSlug] ??= {};
    const recipientsKey = recipientAddresses.sort().toString();
    for (const giftCard of Object.values(this.fundsByIdPerBatch[batch.batchSlug])) {
      if (
        giftCard.isGiftCardBatch &&
        giftCard.recipientsKey === recipientsKey &&
        giftCard.microgonsRemaining >= microgons
      ) {
        return giftCard;
      }
    }
  }

  public async recordGiftCard(
    batchSlug: string,
    giftCard: ISidechainApiTypes['GiftCard.claim']['result'],
  ): Promise<IMicronoteFund> {
    await this.activeGiftCardFundsPromise;
    this.fundsByIdPerBatch[batchSlug] ??= {};
    this.fundsByIdPerBatch[batchSlug][giftCard.fundsId] = {
      ...giftCard,
      batchSlug,
      isGiftCardBatch: true,
      microgonsRemaining: giftCard.microgons,
      recipientsKey: giftCard.redeemableWithAddresses.sort().toString(),
    };
    return this.fundsByIdPerBatch[batchSlug][giftCard.fundsId];
  }

  public async reserveFunds(
    microgons: number,
    recipientAddresses?: string[],
    retries = 5,
  ): Promise<{ fund: IMicronoteFund; batch: IMicronoteBatch }> {
    let shouldRetry: boolean;

    const batchFund = await this.queue.run<{ fund: IMicronoteFund; batch: IMicronoteBatch }>(
      async () => {
        const { active, giftCard } = await this.getActiveBatches();
        /// CHECK GiftCardS

        const giftCardFund = await this.findGiftCardForRecipients(
          microgons,
          recipientAddresses,
          giftCard,
        );

        if (giftCardFund) {
          giftCardFund.microgonsRemaining -= microgons;
          return { fund: giftCardFund, batch: giftCard };
        }

        /// USE REAL BATCH MICRONOTE FUNDS

        if (!this.activeFundsId) {
          try {
            const response = await this.findBatchFund(active, microgons);
            if (response?.fundsId) {
              this.activeFundsId = response.fundsId;
            } else {
              const centagons = Math.ceil((microgons * this.queryFundingToPreload) / 10e3);
              const fundResponse = await this.fundBatch(active, centagons);
              this.activeFundsId = fundResponse.fundsId;
            }
          } catch (error) {
            // if nsf, don't keep looping and retrying
            if (this.isRetryableErrorCode(error.code) && retries >= 0) {
              shouldRetry = true;
              this.activeFundsId = null;
            } else {
              throw error;
            }
          }
        }

        try {
          const fund = this.updateBatchFundsRemaining(
            active.batchSlug,
            this.activeFundsId,
            microgons,
          );
          if (fund) {
            return { fund, batch: active };
          }
        } catch (error) {
          // if nsf, don't keep looping and retrying
          if (error.code === 'ERR_NEEDS_BATCH_FUNDING' && retries >= 0) {
            shouldRetry = true;
            this.activeFundsId = null;
          } else {
            throw error;
          }
        }
      },
    );

    if (batchFund) return batchFund;

    // if cleared out, retry (had to wait for queue to finish)
    if (shouldRetry) {
      await new Promise(resolve => setTimeout(resolve, 200));
      return this.reserveFunds(microgons, recipientAddresses, retries - 1);
    }
  }

  public async findBatchFund(
    batch: IMicronoteBatch,
    microgons: number,
  ): Promise<IMicronoteFund | null> {
    const response = await this.client.runRemote('MicronoteBatch.findFund', {
      microgons,
      batchSlug: batch.batchSlug,
      address: this.client.address,
    });
    if (!response?.fundsId) return null;

    return this.recordBatchFund(response.fundsId, response.microgonsRemaining, batch);
  }

  /**
   * To create an micronoteBatch, we need to transfer tokens to the micronoteBatch server public keys on the
   * Ulixee fast token chain.
   *
   * NOTE: this should ONLY be done for a trusted micronoteBatch service (see verifyMicronoteBatchUrl above)
   */
  public async fundBatch(batch: IMicronoteBatch, centagons: number): Promise<IMicronoteFund> {
    const { batchSlug } = batch;
    const note = await this.client.buildNote(
      centagons,
      batch.micronoteBatchAddress,
      NoteType.micronoteFunds,
    );

    const { fundsId } = await this.client.runRemote('MicronoteBatch.fund', {
      note,
      batchSlug,
    });

    return this.recordBatchFund(fundsId, Number(centagons) * 10e3, batch);
  }

  public recordBatchFund(
    fundsId: number,
    microgons: number,
    batch: IMicronoteBatch,
    allowedRecipientAddresses?: string[],
  ): IMicronoteFund {
    allowedRecipientAddresses ??= [];
    const recipientsKey = allowedRecipientAddresses.sort().toString();
    this.fundsByIdPerBatch[batch.batchSlug] ??= {};
    this.fundsByIdPerBatch[batch.batchSlug][fundsId] = {
      fundsId,
      microgonsRemaining: microgons,
      isGiftCardBatch: batch.isGiftCardBatch,
      batchSlug: batch.batchSlug,
      allowedRecipientAddresses,
      recipientsKey,
    };
    return this.fundsByIdPerBatch[batch.batchSlug][fundsId];
  }

  public updateBatchFundsRemaining(
    batchSlug: string,
    fundsId: number,
    microgons: number,
  ): IMicronoteFund {
    if (!fundsId) return null;

    this.fundsByIdPerBatch[batchSlug] ??= {};
    const fund = this.fundsByIdPerBatch[batchSlug][fundsId];
    if (fund) {
      if (fund.microgonsRemaining < microgons) {
        throw new NeedsSidechainBatchFunding('Needs a new batch fund', microgons);
      }
      fund.microgonsRemaining -= microgons;
    }
    return fund;
  }

  public async getFundSettlements(
    batchSlug: string,
    fundIds: number[],
  ): Promise<ISidechainApiTypes['MicronoteBatch.getFundSettlement']['result']> {
    return await this.client.runRemote('MicronoteBatch.getFundSettlement', {
      fundIds,
      batchSlug,
    });
  }

  public async getActiveFunds(
    batch: IMicronoteBatch,
  ): Promise<ISidechainApiTypes['MicronoteBatch.activeFunds']['result']> {
    const funds = await this.client.runRemote('MicronoteBatch.activeFunds', {
      batchSlug: batch.batchSlug,
      address: this.client.address,
    });
    for (const fund of funds) {
      this.recordBatchFund(
        fund.fundsId,
        fund.microgonsRemaining,
        batch,
        fund.allowedRecipientAddresses,
      );
    }
    return funds;
  }

  public async getActiveBatches(): Promise<ISidechainApiTypes['MicronoteBatch.get']['result']> {
    if (this.activeBatchesPromise) return this.activeBatchesPromise.promise;

    this.activeBatchesPromise = new Resolvable();
    const promise = this.activeBatchesPromise;

    try {
      const batches = await this.client.runRemote('MicronoteBatch.get', undefined);
      this.verifyBatch(batches.active);
      if (batches.giftCard) this.verifyBatch(batches.giftCard);
      promise.resolve(batches);
    } catch (error) {
      this.activeBatchesPromise = null;
      promise.reject(error);
    }

    // return promise in case caller isn't already holder of the getBatchPromise (we just set to null)
    return promise.promise;
  }

  public clearActiveFundsId(fundsId: number): void {
    delete this.fundsByIdPerBatch[fundsId];
    if (this.activeFundsId === fundsId) {
      delete this.activeFundsId;
    }
  }

  public async clearBatch(batchSlug: string): Promise<void> {
    const batches = await this.activeBatchesPromise;
    if (batches.active?.batchSlug === batchSlug) delete this.activeBatchesPromise;
  }

  public shouldRetryFunding(error: Error & any): boolean {
    return this.isRetryableErrorCode(error.code);
  }

  /**
   * Validate any "new" micronoteBatch to ensure it is signed by the root sidechain key
   */
  private verifyBatch(batch: IMicronoteBatch): void {
    const { sidechainIdentity, sidechainValidationSignature, micronoteBatchIdentity } = batch;
    const isValid = Identity.verify(
      sidechainIdentity,
      sha3(micronoteBatchIdentity),
      sidechainValidationSignature,
    );
    if (isValid === false) {
      throw new InvalidSignatureError(
        'The micronoteBatch server does not have a valid sidechain public key validator.',
      );
    }
  }

  private isRetryableErrorCode(code: string): boolean {
    return (
      code !== 'ERR_NSF' &&
      code !== 'ERR_VALIDATION' &&
      code !== 'ERR_SIGNATURE_INVALID' &&
      !code?.startsWith('ERR_IDENTITY_')
    );
  }
}

export type IMicronoteFund = {
  fundsId: number;
  microgonsRemaining: number;
  isGiftCardBatch?: boolean;
  allowedRecipientAddresses?: string[];
  recipientsKey?: string;
  batchSlug: string;
};
