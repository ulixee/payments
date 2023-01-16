import { NoteType } from '@ulixee/specification';
import IMicronoteBatch from '@ulixee/specification/types/IMicronoteBatch';
import { ISidechainApiTypes } from '@ulixee/specification/sidechain';
import Resolvable from '@ulixee/commons/lib/Resolvable';
import Queue from '@ulixee/commons/lib/Queue';
import Identity from '@ulixee/crypto/lib/Identity';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { InvalidSignatureError } from '@ulixee/crypto/lib/errors';
import TimedCache from '@ulixee/commons/lib/TimedCache';
import SidechainClient from './SidechainClient';
import { NeedsSidechainBatchFunding } from './errors';
import ArgonUtils from './ArgonUtils';

export default class MicronoteBatchFunding {
  public queryFundingToPreload = 100;

  private queue = new Queue();

  private fundsByBatchSlug: {
    [batchSlug: string]: {
      activeFundsId?: string;
      fundsById: {
        [fundsId: string]: IMicronoteFund;
      };
    };
  } = {};

  private activeMicronoteBatchSlug: string;

  private activeBatchesPromise = new TimedCache<
    Resolvable<ISidechainApiTypes['Sidechain.openBatches']['result']>
  >(10 * 60);

  constructor(
    readonly client: {
      buildNote: SidechainClient['buildNote'];
      runRemote: SidechainClient['runRemote'];
      address: SidechainClient['address'];
    },
  ) {}

  public async reserveFunds(
    microgons: number,
    recipientAddresses?: string[],
    retries = 5,
  ): Promise<{ fund: IMicronoteFund; batch: IMicronoteBatch }> {
    let shouldRetry: boolean;

    const batchFund = await this.queue.run<{ fund: IMicronoteFund; batch: IMicronoteBatch }>(
      async () => {
        const { micronote } = await this.getActiveBatches();
        let activeBatch = micronote.find(x => x.batchSlug === this.activeMicronoteBatchSlug);
        let activeBatches = micronote;

        if (activeBatch && activeBatch.stopNewNotesTime.getTime() - Date.now() < 30e3) {
          this.clearBatch(activeBatch.batchSlug);

          // minimum of 1 hour should be remaining
          activeBatch = activeBatches.find(
            x => x.stopNewNotesTime.getTime() - Date.now() > 30 * 60e3,
          );

          if (!activeBatch) {
            // clearBatch()) is refreshing activeBatches, so reload now
            const batches = await this.getActiveBatches();
            activeBatches = batches.micronote;
            activeBatch = null;
          }
        }
        /// USE REAL BATCH MICRONOTE FUNDS

        activeBatch ??= activeBatches[0];
        this.activeMicronoteBatchSlug = activeBatch.batchSlug;
        this.fundsByBatchSlug[activeBatch.batchSlug] ??= { fundsById: {} };
        const activeBatchFunds = this.fundsByBatchSlug[activeBatch.batchSlug];

        if (!activeBatchFunds.activeFundsId) {
          try {
            const response = await this.findBatchFund(activeBatch, microgons);
            if (response?.fundsId) {
              activeBatchFunds.activeFundsId = response.fundsId;
            } else {
              let centagons = ArgonUtils.microgonsToCentagons(
                microgons * this.queryFundingToPreload,
                false,
              );

              if (centagons < activeBatch.minimumFundingCentagons) {
                centagons = activeBatch.minimumFundingCentagons;
              }

              const fundResponse = await this.fundBatch(activeBatch, centagons);
              activeBatchFunds.activeFundsId = fundResponse.fundsId;
            }
          } catch (error) {
            delete activeBatchFunds.activeFundsId;
            // if nsf, don't keep looping and retrying
            if (this.isRetryableErrorCode(error.code) && retries >= 0) {
              shouldRetry = true;
              return;
            }
            throw error;
          }
        }

        try {
          const fund = this.updateBatchFundsRemaining(
            this.activeMicronoteBatchSlug,
            activeBatchFunds.activeFundsId,
            microgons,
          );
          if (fund) {
            return { fund, batch: activeBatch };
          }
        } catch (error) {
          // if nsf, don't keep looping and retrying
          if (error.code === 'ERR_NEEDS_BATCH_FUNDING' && retries >= 0) {
            shouldRetry = true;
            this.clearActiveFundsId(this.activeMicronoteBatchSlug, activeBatchFunds.activeFundsId);
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

    const fund = this.recordBatchFund(response.fundsId, response.microgonsRemaining, batch);
    // Make sure server we don't overwrite local state!
    if (fund?.microgonsRemaining >= microgons) return fund;
    return null;
  }

  /**
   * To create an micronoteBatch, we need to transfer tokens to the micronoteBatch server public keys on the
   * Ulixee fast token chain.
   *
   * NOTE: this should ONLY be done for a trusted micronoteBatch service (see verifyMicronoteBatchUrl above)
   */
  public async fundBatch(
    batch: IMicronoteBatch,
    centagons: number | bigint,
  ): Promise<IMicronoteFund> {
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

    return this.recordBatchFund(fundsId, ArgonUtils.centagonsToMicrogons(centagons), batch);
  }

  public recordBatchFund(
    fundsId: string,
    microgons: number,
    batch: IMicronoteBatch,
    allowedRecipientAddresses?: string[],
  ): IMicronoteFund {
    allowedRecipientAddresses ??= [];
    const recipientsKey = allowedRecipientAddresses.sort().toString();
    this.fundsByBatchSlug[batch.batchSlug] ??= { fundsById: {} };
    // NOTE: don't overwrite!!
    this.fundsByBatchSlug[batch.batchSlug].fundsById[fundsId] ??= {
      fundsId,
      microgonsRemaining: microgons,
      batchSlug: batch.batchSlug,
      allowedRecipientAddresses,
      recipientsKey,
    };
    return this.fundsByBatchSlug[batch.batchSlug].fundsById[fundsId];
  }

  public finalizePayment(
    batchSlug: string,
    fundsId: string,
    originalMicrogons: number,
    result: { microgons: number; bytes: number },
  ): void {
    if (!result) return;
    const fundsToReturn = originalMicrogons - result.microgons;
    if (fundsToReturn && Number.isInteger(fundsToReturn)) {
      this.fundsByBatchSlug[batchSlug].fundsById[fundsId].microgonsRemaining += fundsToReturn;
    }
  }

  public updateBatchFundsRemaining(
    batchSlug: string,
    fundsId: string,
    microgons: number,
  ): IMicronoteFund {
    if (!fundsId) return null;

    this.fundsByBatchSlug[batchSlug] ??= { fundsById: {} };
    const fund = this.fundsByBatchSlug[batchSlug].fundsById[fundsId];
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
    fundIds: string[],
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

  public async getActiveBatches(
    refresh = false,
  ): Promise<ISidechainApiTypes['Sidechain.openBatches']['result']> {
    if (this.activeBatchesPromise.value && !refresh) return this.activeBatchesPromise.value.promise;

    this.activeBatchesPromise.value = new Resolvable();
    const promise = this.activeBatchesPromise.value;

    try {
      const batches = await this.client.runRemote('Sidechain.openBatches', undefined);
      for (const batch of batches.micronote) {
        if (!batch) continue;
        this.fundsByBatchSlug[batch.batchSlug] ??= { fundsById: {} };
        this.verifyBatch(batch);
      }
      promise.resolve(batches);
    } catch (error) {
      this.activeBatchesPromise.value = null;
      promise.reject(error);
    }

    // return promise in case caller isn't already holder of the getBatchPromise (we just set to null)
    return promise.promise;
  }

  public clearActiveFundsId(batchSlug: string, fundsId: string): void {
    if (this.fundsByBatchSlug[batchSlug]?.activeFundsId === fundsId) {
      delete this.fundsByBatchSlug[batchSlug].activeFundsId;
    }

    if (this.activeMicronoteBatchSlug === batchSlug) {
      delete this.activeMicronoteBatchSlug;
    }
  }

  public clearBatch(batchSlug: string): void {
    if (this.activeMicronoteBatchSlug === batchSlug) {
      delete this.activeMicronoteBatchSlug;
    }

    this.getActiveBatches(true).catch(() => null);
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
  fundsId: string;
  microgonsRemaining: number;
  allowedRecipientAddresses?: string[];
  recipientsKey?: string;
  batchSlug: string;
};
