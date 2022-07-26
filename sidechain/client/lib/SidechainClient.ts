import { hashObject, sha3 } from '@ulixee/commons/lib/hashUtils';
import { APIError } from '@ulixee/commons/lib/errors';
import { createPromise } from '@ulixee/commons/lib/utils';
import Logger from '@ulixee/commons/lib/Logger';
import { INote, IStakeSignature, IWalletSignature, NoteType } from '@ulixee/specification';
import * as assert from 'assert';
import * as Url from 'url';
import Queue from '@ulixee/commons/lib/Queue';
import Keypair from '@ulixee/crypto/lib/Keypair';
import Keyring from '@ulixee/crypto/lib/Keyring';
import IResolvablePromise from '@ulixee/commons/interfaces/IResolvablePromise';
import { InvalidSignatureError } from '@ulixee/crypto/lib/errors';
import IMicronoteBatch from '@ulixee/specification/types/IMicronoteBatch';
import { ICreateMicronoteResponse } from '@ulixee/specification/sidechain/MicronoteApis';
import SidechainApiSchema, { ISidechainApiTypes } from '@ulixee/specification/sidechain';
import IPaymentProvider from '../interfaces/IPaymentProvider';
import { ClientValidationError, NeedsSidechainBatchFunding } from './errors';
import IMicronote from '../interfaces/IMicronote';
import ConnectionToSidechainCore from './ConnectionToSidechainCore';

const isDebug = process.env.ULX_DEBUG ?? false;

function debugLog(message: string, ...args: any[]): void {
  if (isDebug) {
    // eslint-disable-next-line no-console
    console.log(message, ...args);
  }
}

const { log } = Logger(module);

const sidechainRemotePool: { [url: string]: ConnectionToSidechainCore } = {};

export default class SidechainClient implements IPaymentProvider {
  get batchSlug(): string {
    return this._micronoteBatch ? this._micronoteBatch.batchSlug : '';
  }

  get fullHost(): string {
    return Url.resolve(this.host, this.batchSlug || '');
  }

  get address(): string | null {
    return this.credentials.keyring ? this.credentials.keyring.address : null;
  }

  get publicKey(): Buffer | null {
    return this.credentials.nodeKeypair ? this.credentials.nodeKeypair.publicKey : null;
  }

  public batchFundingQueriesToPreload = 100;

  protected readonly connectionToCore: ConnectionToSidechainCore;

  private _micronoteBatch?: IMicronoteBatch;

  private set micronoteBatch(value: IMicronoteBatch) {
    if (value === null) {
      this.getBatchPromise = null;
      this.getActiveBatchFunds = null;
    }
    this._micronoteBatch = value;
  }

  private batchFundingQueue = new Queue();
  private getActiveBatchFunds: IResolvablePromise<
    ISidechainApiTypes['MicronoteBatch.findFund']['result'] & { batch: IMicronoteBatch }
  >;

  private getBatchPromise?: Promise<IMicronoteBatch>;

  constructor(
    readonly host: string,
    readonly credentials: {
      keyring?: Keyring;
      nodeKeypair?: Keypair;
    },
    micronoteBatch?: IMicronoteBatch,
    keepAliveRemoteConnections = false,
  ) {
    if (keepAliveRemoteConnections) {
      if (!sidechainRemotePool[host])
        sidechainRemotePool[host] = ConnectionToSidechainCore.remote(host);
      this.connectionToCore = sidechainRemotePool[host];
    } else {
      this.connectionToCore = ConnectionToSidechainCore.remote(host);
    }
    if (micronoteBatch) this.micronoteBatch = micronoteBatch;
  }

  /**
   * To create an micronoteBatch, we need to transfer tokens to the micronoteBatch server public keys on the
   * Ulixee fast token chain.
   *
   * NOTE: this should ONLY be done for a trusted micronoteBatch service (see verifymicronoteBatchUrl above)
   */
  public async fundMicronoteBatch(
    centagons: number,
  ): Promise<{ fundsId: number; batch: IMicronoteBatch }> {
    const batch = await this.getMicronoteBatch();
    const note = await this.buildNote(
      centagons,
      this._micronoteBatch.micronoteBatchAddress,
      NoteType.micronoteFunds,
    );

    // not signing whole package, so can't use runMultisigRemote
    const { fundsId } = await this.runRemote('MicronoteBatch.fund', {
      note,
      batchSlug: batch.batchSlug,
    });

    await this.recordBatchFunding({ fundsId, microgonsRemaining: centagons * 10e3 }, batch);

    return { fundsId, batch };
  }

  public async getFundSettlement(
    batchAddress: string,
    fundIds: number[],
  ): Promise<ISidechainApiTypes['MicronoteBatch.getFundSettlement']['result']> {
    return await this.runRemote('MicronoteBatch.getFundSettlement', {
      fundIds,
      batchAddress,
    });
  }

  public async reserveBatchFunds(
    microgons: number,
    retries = 5,
  ): Promise<ISidechainApiTypes['MicronoteBatch.findFund']['result'] & { batch: IMicronoteBatch }> {
    await this.batchFundingQueue.run(async () => {
      if (this.getActiveBatchFunds) {
        await this.debitFromActiveBatchFund(microgons);
        return;
      }

      const promise = createPromise<
        ISidechainApiTypes['MicronoteBatch.findFund']['result'] & { batch: IMicronoteBatch }
      >();
      this.getActiveBatchFunds = promise;

      try {
        const batch = await this.getMicronoteBatch();

        const response = await this.runRemote('MicronoteBatch.findFund', {
          microgons,
          batchSlug: batch.batchSlug,
          address: this.address,
        });
        if (response?.fundsId) {
          promise.resolve({
            ...response,
            batch,
          });
        } else {
          const centagons = Math.ceil((microgons * this.batchFundingQueriesToPreload) / 10e3);
          await this.fundMicronoteBatch(centagons);
        }
        await this.debitFromActiveBatchFund(microgons);
      } catch (error) {
        // if nsf, don't keep looping and retrying
        if (this.isRetryableErrorCode(error.code) && retries >= 0) {
          this.getActiveBatchFunds = null;
        } else {
          promise.reject(error);
        }
      }
    });

    if (!this.getActiveBatchFunds) {
      await new Promise(resolve => setTimeout(resolve, 200));
      return this.reserveBatchFunds(microgons, retries - 1);
    }

    const funds = await this.getActiveBatchFunds.promise;

    return {
      ...funds,
    };
  }

  public async getMicronoteBatch(): Promise<ISidechainApiTypes['MicronoteBatch.get']['result']> {
    if (this.getBatchPromise) return await this.getBatchPromise;

    const promise = createPromise<IMicronoteBatch>();
    this.getBatchPromise = promise.promise;

    try {
      const batch = await this.runRemote('MicronoteBatch.get', undefined);
      await this.verifyBatch(batch);
      promise.resolve(this._micronoteBatch);
    } catch (error) {
      this.getBatchPromise = null;
      promise.reject(error);
    }

    // return promise in case caller isn't already holder of the getBatchPromise (we just set to null)
    return promise.promise;
  }

  public async createMicronoteUnsafe(
    batch: IMicronoteBatch,
    microgons: number,
    isAuditable: boolean,
    fundsId: number,
  ): Promise<ISidechainApiTypes['Micronote.create']['result']> {
    isAuditable ??= true;
    try {
      const response = await this.runSignedByWallet('Micronote.create', {
        batchSlug: batch.batchSlug,
        address: this.address,
        fundsId,
        isAuditable,
        microgons,
      });
      await this.verifyMicronoteSignature(batch.micronoteBatchPublicKey, microgons, response);
      return response;
    } catch (error) {
      if (error.code === 'ERR_NEEDS_BATCH_FUNDING') {
        this.getActiveBatchFunds = null;
        throw new NeedsSidechainBatchFunding(
          'No micronote batch funding found on the sidechain',
          error.data.minCentagonsNeeded,
        );
      } else {
        this.micronoteBatch = null;
      }
      throw error;
    }
  }

  /**
   * To allocate tokens to a note, you must create an micronoteBatch on a Ulixee fast token micronoteBatch service.
   */
  public async createMicronote(
    microgons: number,
    isAuditable = true,
    schemaUri?: string,
    tries = 0,
  ): Promise<IMicronote> {
    if (tries >= 5) {
      throw new Error('Could not create new Micronote after 5 retries');
    }

    try {
      const batchFunds = await this.reserveBatchFunds(microgons);

      const response = await this.createMicronoteUnsafe(
        batchFunds.batch,
        microgons,
        isAuditable,
        batchFunds.fundsId,
      );

      return {
        ...response,
        ...this._micronoteBatch,
        micronoteBatchUrl: this.fullHost,
      };
    } catch (error) {
      if (
        error.code === 'ERR_CLOSING' ||
        error.code === 'ERR_CLOSED' ||
        error.code === 'ERR_NOT_FOUND'
      ) {
        this.micronoteBatch = null;
      }

      if (!this.isRetryableErrorCode(error.code)) {
        throw error;
      }

      return this.createMicronote(microgons, isAuditable, schemaUri, tries + 1);
    }
  }

  public async lockMicronote(
    micronoteId: Buffer,
  ): Promise<ISidechainApiTypes['Micronote.lock']['result']> {
    return await this.runSignedAsNode('Micronote.lock', {
      batchSlug: this.batchSlug,
      id: micronoteId,
      publicKey: this.credentials.nodeKeypair.publicKey,
    });
  }

  public async claimMicronote(
    micronoteId: Buffer,
    tokenAllocation: { [publicKey: string]: number },
  ): Promise<ISidechainApiTypes['Micronote.claim']['result']> {
    return await this.runSignedAsNode('Micronote.claim', {
      batchSlug: this.batchSlug,
      id: micronoteId,
      tokenAllocation,
      publicKey: this.credentials.nodeKeypair.publicKey,
    });
  }

  /////// WALLET APIS   ///////////////////////////////////////////////////////////////////////////

  public async register(): Promise<ISidechainApiTypes['Wallet.register']['result']> {
    return await this.runSignedByWallet('Wallet.register', {
      address: this.address,
    });
  }

  public async getBalance(address?: string): Promise<bigint> {
    const res = await this.runRemote('Wallet.getBalance', {
      address: address || this.address,
    });
    return res.balance;
  }

  /////// NOTE APIS   //////////////////////////////////////////////////////////////////////////////

  public async transferNote(centagons: bigint, toAddress: string): Promise<INote> {
    const note = this.buildNote(centagons, toAddress, NoteType.transfer);
    await this.runRemote('Note.create', {
      note,
    });
    return note;
  }

  public async getNote(noteHash: Buffer): Promise<INote> {
    const res = await this.runRemote('Note.get', {
      noteHash,
    });
    return res.note;
  }

  /////// STAKE APIS       /////////////////////////////////////////////////////////////////////////

  public async createStake(stakedPublicKey: Buffer): Promise<IStakeSignature> {
    const settings = await this.stakeSettings();
    const note = this.buildNote(settings.centagons, settings.stakeAddress, NoteType.stakeCreate);
    const response = await this.runRemote('Stake.create', {
      note,
      stakedPublicKey,
    });
    return {
      ...response,
      ...settings,
    };
  }

  public async refundStake(
    stakedPublicKey: Buffer,
  ): Promise<ISidechainApiTypes['Stake.refund']['result']> {
    return await this.runSignedByWallet('Stake.refund', {
      address: this.address,
      stakedPublicKey,
    });
  }

  public async getStakeSignature(): Promise<ISidechainApiTypes['Stake.signature']['result']> {
    return await this.runSignedAsNode('Stake.signature', {
      stakedPublicKey: this.credentials.nodeKeypair.publicKey,
    });
  }

  public async stakeSettings(): Promise<ISidechainApiTypes['Stake.settings']['result']> {
    return await this.runRemote('Stake.settings', null);
  }

  /////// FUNDING TRANSFER   ///////////////////////////////////////////////////////////////////////

  public async returnFundsToMainchain(
    centagons: number,
  ): Promise<ISidechainApiTypes['FundingTransfer.out']['result']> {
    const keys = await this.getSidechainFundingKeys();

    const note = this.buildNote(centagons, keys.transferOutKey, NoteType.transferOut);
    return await this.runRemote('FundingTransfer.out', {
      note,
    });
  }

  public async getSidechainFundingKeys(): Promise<
    ISidechainApiTypes['FundingTransfer.keys']['result']
  > {
    return await this.runRemote('FundingTransfer.keys', {});
  }

  public async getMainchainTransferStatus(
    noteHash: Buffer,
  ): Promise<ISidechainApiTypes['FundingTransfer.status']['result']> {
    return await this.runRemote('FundingTransfer.status', {
      noteHash,
    });
  }

  /////// HELPERS      /////////////////////////////////////////////////////////////////////////////

  protected async runSignedByWallet<T extends keyof ISidechainApiTypes & string>(
    command: T,
    args: Omit<ISidechainApiTypes[T]['args'], 'signature'>,
    retries = 5,
  ): Promise<ISidechainApiTypes[T]['result']> {
    assert(!!this.credentials.keyring, `${command} api call requires an wallet keyring`);
    const messageHash = hashObject(args, {
      prefix: Buffer.from(command),
    });
    const signature = this.buildSignature(messageHash, true);
    debugLog(command, {
      args,
      signature,
      address: this.address,
    });

    return await this.runRemote(
      command,
      {
        ...args,
        signature,
      },
      retries,
    );
  }

  protected async runSignedAsNode<T extends keyof ISidechainApiTypes & string>(
    command: T,
    args: Omit<ISidechainApiTypes[T]['args'], 'signature'>,
    retries = 5,
  ): Promise<ISidechainApiTypes[T]['result']> {
    assert(!!this.credentials.nodeKeypair, `${command} api call requires a node keypair`);
    const messageHash = hashObject(args, {
      prefix: Buffer.concat([Buffer.from(command), this.credentials.nodeKeypair.publicKey]),
    });
    const signature = this.credentials.nodeKeypair.sign(messageHash);
    debugLog(command, {
      ...args,
      publicKey: this.credentials.nodeKeypair.publicKey,
      signature,
    });

    return await this.runRemote(
      command,
      {
        ...args,
        signature,
      },
      retries,
    );
  }

  protected async runRemote<T extends keyof ISidechainApiTypes & string>(
    command: T,
    args: ISidechainApiTypes[T]['args'],
    retries = 5,
    validate = true,
  ): Promise<ISidechainApiTypes[T]['result']> {
    try {
      if (validate) {
        args = await SidechainApiSchema[command].args.parseAsync(args);
      }
    } catch (error) {
      const errors = error.issues.map(x => `"${x.path.join('.')}": ${x.message}`);
      throw new ClientValidationError(command, errors);
    }
    try {
      return await this.connectionToCore.sendRequest({ command, args: [args] as any });
    } catch (error) {
      if (retries >= 0 && this.shouldRetryError(error)) {
        const timeoutMillis = 2 ** (5 - retries) * 1e3;
        log.warn('RemoteEncounteredError, retrying', { error, timeoutMillis, sessionId: null });
        await new Promise(resolve => setTimeout(resolve, timeoutMillis));
        return await this.runRemote(command, args, retries - 1);
      }
      log.error('Error running remote API', {
        error,
        command,
        attempts: 5 - retries,
        sessionId: null,
      });
      throw error;
    }
  }

  private shouldRetryError(error: Error & { code?: string }): boolean {
    if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') return true;

    if (error instanceof APIError) {
      return error.status === 502 || error.status === 503;
    }
    return false;
  }

  private isRetryableErrorCode(code: string): boolean {
    return (
      code !== 'ERR_NSF' &&
      code !== 'ERR_VALIDATION' &&
      code !== 'ERR_SIGNATURE_INVALID' &&
      !code?.startsWith('ERR_KEY_')
    );
  }

  private async recordBatchFunding(
    result: ISidechainApiTypes['MicronoteBatch.fund']['result'] & { microgonsRemaining: number },
    batch: IMicronoteBatch,
  ): Promise<void> {
    this.getActiveBatchFunds ??= createPromise();

    if (this.getActiveBatchFunds.isResolved) {
      const value = await this.getActiveBatchFunds.promise;
      value.microgonsRemaining = result.microgonsRemaining;
      value.fundsId = result.fundsId;
    } else {
      this.getActiveBatchFunds.resolve({
        ...result,
        batch,
      });
    }
  }

  private async debitFromActiveBatchFund(microgons: number, retry = false): Promise<void> {
    const funds = await this.getActiveBatchFunds.promise;
    funds.microgonsRemaining -= microgons;

    if (funds.microgonsRemaining < 0) {
      if (retry) throw new Error('Error getting batch funds with funding');
      const centagons = Math.ceil(microgons / 10e3) * this.batchFundingQueriesToPreload;
      await this.fundMicronoteBatch(centagons);
      return this.debitFromActiveBatchFund(microgons, true);
    }
  }

  private buildNote(centagons: number | bigint, toAddress: string, type: NoteType): INote {
    const note = {
      toAddress,
      centagons: BigInt(centagons),
      fromAddress: this.address,
      timestamp: new Date(),
      type,
      noteHash: null,
      signature: null,
    } as INote;

    note.noteHash = hashObject(note, { ignoreProperties: ['noteHash', 'signature'] });
    note.signature = this.buildSignature(note.noteHash);
    return note;
  }

  private buildSignature(hash: Buffer, isClaim = false): IWalletSignature {
    const indices = Keyring.getKeyIndices(this.credentials.keyring.keyringSettings, isClaim);
    return this.credentials.keyring.sign(hash, indices, isClaim);
  }

  /**
   * Validate any "new" micronoteBatch to ensure it is signed by the root sidechain key
   */
  private verifyBatch(batch: IMicronoteBatch): void {
    const { batchSlug, sidechainPublicKey, sidechainValidationSignature, micronoteBatchPublicKey } =
      batch;
    if (this.batchSlug !== batchSlug) {
      const isValid = Keypair.verify(
        sidechainPublicKey,
        sha3(micronoteBatchPublicKey),
        sidechainValidationSignature,
      );
      if (isValid === false) {
        throw new InvalidSignatureError(
          'The micronoteBatch server does not have a valid sidechain public key validator.',
        );
      }
      this.micronoteBatch = batch;
    }
  }

  private verifyMicronoteSignature(
    publicKey: Buffer,
    microgons: number,
    micronote: ICreateMicronoteResponse,
  ): void {
    try {
      const isValid = Keypair.verify(
        publicKey,
        sha3(Buffer.concat([micronote.id, Buffer.from(`${microgons}`)])),
        micronote.micronoteSignature,
      );
      if (isValid === false) {
        throw new InvalidSignatureError('Invalid Micronote signature');
      }
    } catch (error) {
      throw new InvalidSignatureError(`Could not parse signature - ${error.message}`);
    }
  }
}
