import { hashObject, sha3 } from '@ulixee/commons/lib/hashUtils';
import { APIError } from '@ulixee/commons/lib/errors';
import Logger from '@ulixee/commons/lib/Logger';
import {
  IAddressSignature,
  INote,
  IPayment,
  IStakeSignature,
  NoteType,
} from '@ulixee/specification';
import * as assert from 'assert';
import Identity from '@ulixee/crypto/lib/Identity';
import Address from '@ulixee/crypto/lib/Address';
import { InvalidSignatureError } from '@ulixee/crypto/lib/errors';
import SidechainApiSchema, { ISidechainApiTypes } from '@ulixee/specification/sidechain';
import { concatAsBuffer } from '@ulixee/commons/lib/bufferUtils';
import { bindFunctions } from '@ulixee/commons/lib/utils';
import IPaymentProvider from '../interfaces/IPaymentProvider';
import { ClientValidationError } from './errors';
import ConnectionToSidechainCore from './ConnectionToSidechainCore';
import MicronoteBatchFunding from './MicronoteBatchFunding';
import IMicronote from '../interfaces/IMicronote';
import env from '../env';

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
  get address(): string | null {
    return this.credentials.address ? this.credentials.address.bech32 : null;
  }

  get identity(): string | null {
    return this.credentials.identity ? this.credentials.identity.bech32 : null;
  }

  public readonly host: string;

  public readonly micronoteBatchFunding: MicronoteBatchFunding;

  protected readonly connectionToCore: ConnectionToSidechainCore;
  private settingsPromise: Promise<ISidechainApiTypes['Sidechain.settings']['result']>;

  constructor(
    host: string,
    readonly credentials: {
      address?: Address;
      identity?: Identity;
    },
    keepAliveRemoteConnections = false,
  ) {
    bindFunctions(this);
    host ||= env.sidechainHost;
    if (!host.startsWith('http')) host = `http://${host}`;
    this.host = host;
    if (keepAliveRemoteConnections) {
      sidechainRemotePool[host] ??= ConnectionToSidechainCore.remote(host);
      this.connectionToCore = sidechainRemotePool[host];
    } else {
      this.connectionToCore = ConnectionToSidechainCore.remote(host);
    }
    this.micronoteBatchFunding = new MicronoteBatchFunding({
      address: this.address,
      buildNote: this.buildNote.bind(this),
      runRemote: this.runRemote.bind(this),
    });
  }

  public async getSettings(
    requireProof: boolean,
    refresh = false,
  ): Promise<ISidechainApiTypes['Sidechain.settings']['result']> {
    if (!this.settingsPromise || refresh) {
      this.settingsPromise = this.runRemote('Sidechain.settings', {
        identity: requireProof ? this.identity : null,
      });
      if (requireProof && this.identity) {
        const settings = await this.settingsPromise;
        for (let i = 0; i < settings.rootIdentities.length; i += 1) {
          const sidechainIdentity = settings.rootIdentities[i];
          const signature = settings.identityProofSignatures[i];
          const isValid = Identity.verify(
            sidechainIdentity,
            sha3(concatAsBuffer('Sidechain.settings', this.identity)),
            signature,
          );

          if (!isValid)
            throw new InvalidSignatureError(
              `The signature proving the Sidechain RootIdentity (${sidechainIdentity}, ${i}) is invalid.`,
            );
        }
      }
    }
    return this.settingsPromise;
  }

  public getAudit(): Promise<ISidechainApiTypes['Sidechain.audit']['result']> {
    return this.runRemote('Sidechain.audit', undefined);
  }

  public async createMicroPayment(pricing: {
    microgons: number;
  }): Promise<IPayment & { onFinalized(result: { microgons: number; bytes: number }): void }> {
    pricing.microgons ??= 0;

    const settings = await this.getSettings(true);

    if (!pricing.microgons) return { onFinalized() {} };

    let microgons = pricing.microgons;
    if (settings.settlementFeeMicrogons) microgons += settings.settlementFeeMicrogons;

    const { id: micronoteId, ...micronote } = await this.createMicronote(microgons);

    return {
      micronote: {
        ...micronote,
        micronoteId,
        microgons,
      },
      onFinalized: this.micronoteBatchFunding.finalizePayment.bind(
        this.micronoteBatchFunding,
        micronote.batchSlug,
        micronote.fundsId,
        microgons,
      ),
    };
  }

  /**
   * To allocate tokens to a note, you must create an micronoteBatch on a Ulixee fast token micronoteBatch service.
   */
  public async createMicronote(
    microgons: number,
    recipientAddresses?: string[],
    isAuditable = true,
    tries = 0,
  ): Promise<IMicronote> {
    if (tries >= 5) {
      throw new Error('Could not create new Micronote after 5 retries');
    }

    const funds = await this.micronoteBatchFunding.reserveFunds(microgons, recipientAddresses);
    const { fund, batch } = funds;

    try {
      const response = await this.runSignedByAddress('Micronote.create', {
        batchSlug: batch.batchSlug,
        address: this.address,
        fundsId: fund.fundsId,
        isAuditable,
        microgons,
      });

      await this.verifyMicronoteSignature(batch.micronoteBatchIdentity, microgons, response);

      return {
        ...response,
        ...batch,
        micronoteBatchUrl: new URL(batch.batchSlug, batch.batchHost ?? this.host).href,
      };
    } catch (error) {
      // restore funds
      this.micronoteBatchFunding.updateBatchFundsRemaining(
        batch.batchSlug,
        fund.fundsId,
        -microgons,
      );
      if (
        error.code === 'ERR_CLOSING' ||
        error.code === 'ERR_CLOSED' ||
        error.code === 'ERR_NOT_FOUND'
      ) {
        await this.micronoteBatchFunding.clearBatch(fund.batchSlug);
        this.micronoteBatchFunding.clearActiveFundsId(fund.batchSlug, fund.fundsId);
      }

      if (error.code === 'ERR_NEEDS_BATCH_FUNDING') {
        this.micronoteBatchFunding.clearActiveFundsId(fund.batchSlug, fund.fundsId);
      }

      if (!this.micronoteBatchFunding.shouldRetryFunding(error)) {
        throw error;
      }

      return this.createMicronote(microgons, recipientAddresses, isAuditable, tries + 1);
    }
  }

  public async holdMicronoteFunds(
    micronoteId: string,
    batchSlug: string,
    microgons: number,
    holdAuthorizationCode?: string,
  ): Promise<ISidechainApiTypes['Micronote.hold']['result']> {
    return await this.runSignedByIdentity('Micronote.hold', {
      batchSlug,
      id: micronoteId,
      identity: this.identity,
      microgons,
      holdAuthorizationCode,
    });
  }

  public async settleMicronote(
    micronoteId: string,
    batchSlug: string,
    holdId: string,
    tokenAllocation: { [identity: string]: number },
    isFinal = false,
  ): Promise<ISidechainApiTypes['Micronote.settle']['result']> {
    return await this.runSignedByIdentity('Micronote.settle', {
      batchSlug,
      id: micronoteId,
      holdId,
      tokenAllocation,
      identity: this.identity,
      isFinal,
    });
  }

  /////// WALLET APIS   ///////////////////////////////////////////////////////////////////////////

  public async register(): Promise<ISidechainApiTypes['Address.register']['result']> {
    return await this.runRemote('Address.register', {
      address: this.address,
    });
  }

  public async getBalance(address?: string): Promise<bigint> {
    const res = await this.runRemote('Address.getBalance', {
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

  public async createStake(stakedIdentity: string): Promise<IStakeSignature> {
    const settings = await this.stakeSettings();
    const note = this.buildNote(settings.centagons, settings.stakeAddress, NoteType.stakeCreate);
    const response = await this.runRemote('Stake.create', {
      note,
      stakedIdentity,
    });
    return {
      ...response,
      ...settings,
    };
  }

  public async refundStake(
    stakedIdentity: string,
  ): Promise<ISidechainApiTypes['Stake.refund']['result']> {
    return await this.runSignedByAddress('Stake.refund', {
      address: this.address,
      stakedIdentity,
    });
  }

  public async getStakeSignature(): Promise<ISidechainApiTypes['Stake.signature']['result']> {
    return await this.runSignedByIdentity('Stake.signature', {
      stakedIdentity: this.identity,
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

  public async runRemote<T extends keyof ISidechainApiTypes & string>(
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
      console.error(args, error);
      const errors = error.issues.map(x => `"${x.path.join('.')}": ${x.message}`);
      throw new ClientValidationError(command, errors);
    }
    try {
      return await this.sendRequest({ command, args });
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

  protected async runSignedByAddress<T extends keyof ISidechainApiTypes & string>(
    command: T,
    args: Omit<ISidechainApiTypes[T]['args'], 'signature'>,
    retries = 5,
  ): Promise<ISidechainApiTypes[T]['result']> {
    assert(!!this.credentials.address, `${command} api call requires an wallet address`);
    const messageHash = hashObject(args, {
      prefix: Buffer.from(command),
    });
    const signature = this.createAddressSignature(messageHash, true);
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

  protected async runSignedByIdentity<T extends keyof ISidechainApiTypes & string>(
    command: T,
    args: Omit<ISidechainApiTypes[T]['args'], 'signature'>,
    retries = 5,
  ): Promise<ISidechainApiTypes[T]['result']> {
    assert(!!this.credentials.identity, `${command} api call requires an Identity`);
    const messageHash = hashObject(args, {
      prefix: concatAsBuffer(command, this.identity),
    });
    const signature = this.credentials.identity.sign(messageHash);
    debugLog(command, {
      ...args,
      identity: this.identity,
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

  // Method for overriding in tests
  private sendRequest<T extends keyof ISidechainApiTypes & string>(request: {
    command: T;
    args: ISidechainApiTypes[T]['args'];
  }): Promise<ISidechainApiTypes[T]['result']> {
    const { command, args } = request;
    return this.connectionToCore.sendRequest({ command, args: [args] as any });
  }

  private shouldRetryError(error: Error & { code?: string }): boolean {
    if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') return true;

    if (error instanceof APIError) {
      return error.status === 502 || error.status === 503;
    }
    return false;
  }

  private verifyMicronoteSignature(
    batchIdentity: string,
    microgons: number,
    micronoteResponse: ISidechainApiTypes['Micronote.create']['result'],
  ): void {
    try {
      const isValid = Identity.verify(
        batchIdentity,
        sha3(concatAsBuffer(micronoteResponse.id, microgons)),
        micronoteResponse.micronoteSignature,
      );
      if (isValid === false) {
        throw new InvalidSignatureError('Invalid Micronote signature');
      }
    } catch (error) {
      if (error instanceof InvalidSignatureError) throw error;

      throw new InvalidSignatureError(`Could not parse signature - ${error.message}`);
    }
  }

  private buildNote(centagons: number | bigint, toAddress: string, type: NoteType): INote {
    return SidechainClient.buildNote(this.credentials.address, centagons, toAddress, type);
  }

  private createAddressSignature(hash: Buffer, isClaim = false): IAddressSignature {
    return SidechainClient.createAddressSignature(this.credentials.address, hash, isClaim);
  }

  public static buildNote(
    address: Address,
    centagons: number | bigint,
    toAddress: string,
    type: NoteType,
  ): INote {
    const note = {
      toAddress,
      centagons: BigInt(centagons),
      fromAddress: address.bech32,
      timestamp: new Date(),
      type,
      noteHash: null,
      signature: null,
    } as INote;

    note.noteHash = hashObject(note, { ignoreProperties: ['noteHash', 'signature'] });
    note.signature = this.createAddressSignature(address, note.noteHash);
    return note;
  }

  public static createAddressSignature(
    address: Address,
    hash: Buffer,
    isClaim = false,
  ): IAddressSignature {
    const indices = Address.getIdentityIndices(address.addressSettings, isClaim);
    return address.sign(hash, indices, isClaim);
  }
}
