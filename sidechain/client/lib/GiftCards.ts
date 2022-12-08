import { existsAsync, readFileAsJson, safeOverwriteFile } from '@ulixee/commons/lib/fileUtils';
import { ISidechainApiTypes } from '@ulixee/specification/sidechain';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer, decodeBuffer, encodeBuffer } from '@ulixee/commons/lib/bufferUtils';
import * as Path from 'path';
import UlixeeConfig from '@ulixee/commons/config';
import * as Fs from 'fs';
import { KeyObject } from 'crypto';
import Ed25519 from '@ulixee/crypto/lib/Ed25519';
import Identity from '@ulixee/crypto/lib/Identity';
import SidechainClient from './SidechainClient';

let didCheckGiftCardDir = false;
export default class GiftCards {
  public static encodingPrefix = 'gft';

  public byId: { [giftCardId: string]: IGiftCardBalance } = {};

  public get storagePath(): string {
    return Path.join(UlixeeConfig.global.directoryPath, 'giftCards.json');
  }

  private loadGiftCardsPromise: Promise<any>;

  private get identity(): string {
    return this.sidechainClient.identity;
  }

  private get credentials(): SidechainClient['credentials'] {
    return this.sidechainClient.credentials;
  }

  private get micronoteBatchFunding(): SidechainClient['micronoteBatchFunding'] {
    return this.sidechainClient.micronoteBatchFunding;
  }

  constructor(readonly sidechainClient: SidechainClient) {}

  public async store(giftCardId: string, redemptionKey: string): Promise<IGiftCardBalance> {
    await this.loadAll(giftCardId);
    const giftCard = this.byId[giftCardId];
    giftCard.redemptionKey = redemptionKey;
    if (giftCard.microgonsRemaining > 0) {
      await this.saveToDisk();
    }
    return giftCard;
  }

  public async find(microgons: number, issuerIdentities: string[]): Promise<IGiftCardBalance> {
    await this.getStored();
    issuerIdentities ??= [];
    const key = issuerIdentities.sort().toString();
    for (const giftCard of Object.values(this.byId)) {
      if (giftCard.identitiesKey.includes(key) && giftCard.microgonsRemaining >= microgons) {
        return giftCard;
      }
    }
  }

  public async loadAll(...giftCardIds: string[]): Promise<GiftCards['byId']> {
    const batch = (await this.micronoteBatchFunding.getActiveBatches()).giftCard;
    if (!batch) return;
    const giftCards = await Promise.allSettled(giftCardIds.map(x => this.get(x)));
    for (const giftResult of giftCards) {
      if (giftResult.status !== 'fulfilled') continue;
      const gift = giftResult.value;
      this.byId[gift.id] = {
        giftCardId: gift.id,
        microgonsRemaining: gift.balance,
        sidechainIdentity: batch.sidechainIdentity,
        redemptionKey: this.byId[gift.id]?.redemptionKey,
        issuerIdentities: gift.issuerIdentities,
        identitiesKey: (gift.issuerIdentities ?? []).sort().toString(),
      };
    }
    return this.byId;
  }

  public async get(giftCardId: string): Promise<ISidechainApiTypes['GiftCard.get']['result']> {
    const { giftCard: giftCardBatch } = await this.micronoteBatchFunding.getActiveBatches();
    return await this.sidechainClient.runRemote('GiftCard.get', {
      batchSlug: giftCardBatch.batchSlug,
      giftCardId,
    });
  }

  public recordSpend(giftCardId: string, spent: { microgons: number }, error?: Error): void {
    const entry = this.byId[giftCardId];
    if (!entry) return;

    if (error && (error as any).code === 'ERR_NSF') {
      entry.microgonsRemaining = 0;
    } else if (spent && Number.isInteger(spent.microgons)) {
      entry.microgonsRemaining -= spent.microgons;
    }

    if (entry.microgonsRemaining <= 0) {
      delete this.byId[giftCardId];
      this.saveToDisk().catch(() => null);
    }
  }

  public async getStored(): Promise<GiftCards['byId']> {
    if (!this.loadGiftCardsPromise) {
      if (await existsAsync(this.storagePath)) {
        this.byId = await readFileAsJson<IGiftCardBalanceById>(this.storagePath);
        this.loadGiftCardsPromise = this.loadAll(...Object.keys(this.byId));
      }
    }
    return this.loadGiftCardsPromise;
  }

  public async saveToDisk(): Promise<void> {
    if (!didCheckGiftCardDir) {
      const dir = Path.dirname(this.storagePath);
      if (!(await existsAsync(dir))) {
        await Fs.promises.mkdir(dir, { recursive: true });
      }
      didCheckGiftCardDir = true;
    }
    await safeOverwriteFile(this.storagePath, JSON.stringify(this.byId, null, 2));
  }

  public async createUnsaved(
    microgons: number,
    identities?: string[],
  ): Promise<ISidechainApiTypes['GiftCard.create']['args']> {
    const { giftCard: giftCardBatch } = await this.micronoteBatchFunding.getActiveBatches();
    if (!giftCardBatch) throw new Error('This Sidechain does not support gift cards.');

    const giftCard: ISidechainApiTypes['GiftCard.create']['args'] = {
      microgons,
      batchSlug: giftCardBatch.batchSlug,
      issuerSignatures: [],
      issuerIdentities: identities ?? [],
    };
    if (!giftCard.issuerIdentities.includes(this.identity)) {
      giftCard.issuerIdentities.push(this.identity);
    }
    return this.signWithIssuers(giftCard, this.credentials.identity);
  }

  public signWithIssuers(
    giftCard: ISidechainApiTypes['GiftCard.create']['args'],
    identity: Identity,
  ): ISidechainApiTypes['GiftCard.create']['args'] {
    const signatureIndex = giftCard.issuerIdentities.indexOf(identity.bech32);
    if (signatureIndex === -1) {
      throw new Error(`Identity not in issuers list! (${identity.bech32})`);
    }

    const message = sha3(
      concatAsBuffer(
        'GiftCard.create:',
        giftCard.batchSlug,
        giftCard.microgons,
        ...giftCard.issuerIdentities,
      ),
    );
    const signature = identity.sign(message);
    giftCard.issuerSignatures.splice(signatureIndex, 0, signature);
    return giftCard;
  }

  public async create(
    microgons: number,
  ): Promise<ISidechainApiTypes['GiftCard.create']['result'] & { batchSlug: string }> {
    const giftCardRecord = await this.createUnsaved(microgons);
    return await this.save(giftCardRecord);
  }

  public async save(
    giftCard: ISidechainApiTypes['GiftCard.create']['args'],
  ): Promise<ISidechainApiTypes['GiftCard.create']['result'] & { batchSlug: string }> {
    const result = await this.sidechainClient.runRemote('GiftCard.create', giftCard);

    return {
      ...result,
      batchSlug: giftCard.batchSlug,
    };
  }

  public async createHold(
    giftCardId: string,
    redemptionKey: string,
    microgons: number,
  ): Promise<ISidechainApiTypes['GiftCard.createHold']['result']> {
    const { giftCard: giftCardBatch } = await this.micronoteBatchFunding.getActiveBatches();
    const batchSlug = giftCardBatch.batchSlug;
    const key = GiftCards.giftCardRedemptionKeyToKeypair(redemptionKey);
    const message = sha3(
      concatAsBuffer('GiftCard.createHold', ':', batchSlug, giftCardId, microgons, key.publicKey),
    );

    const signature = Ed25519.sign(key.privateKey, message);

    return await this.sidechainClient.runRemote('GiftCard.createHold', {
      batchSlug,
      giftCardId,
      microgons,
      signature,
    });
  }

  public async settleHold(
    giftCardId: string,
    holdId: string,
    microgons: number,
  ): Promise<ISidechainApiTypes['GiftCard.settleHold']['result']> {
    const { giftCard: giftCardBatch } = await this.micronoteBatchFunding.getActiveBatches();
    const batchSlug = giftCardBatch.batchSlug;
    return await this.sidechainClient.runRemote('GiftCard.settleHold', {
      batchSlug,
      giftCardId,
      microgons,
      holdId,
    });
  }

  public static giftCardRedemptionKeyToKeypair(redemptionKey: string): {
    publicKey: Buffer;
    privateKey: KeyObject;
  } {
    const keyBytes = decodeBuffer(redemptionKey, this.encodingPrefix);
    const privateKey = Ed25519.createPrivateKeyFromBytes(keyBytes);
    const publicKey = Ed25519.getPublicKeyBytes(privateKey);
    return { publicKey, privateKey };
  }

  public static encodeGiftCardRedemptionKey(key: KeyObject): string {
    const privateKeyBytes = Ed25519.getPrivateKeyBytes(key);
    return encodeBuffer(privateKeyBytes, this.encodingPrefix);
  }
}

export type IGiftCardBalance = {
  giftCardId: string;
  microgonsRemaining: number;
  sidechainIdentity: string;
  redemptionKey?: string;
  issuerIdentities?: string[];
  identitiesKey?: string;
};

type IGiftCardBalanceById = Record<string, IGiftCardBalance>;
