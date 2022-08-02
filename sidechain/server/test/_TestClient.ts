import { hashObject, sha3 } from '@ulixee/commons/lib/hashUtils';
import Identity from '@ulixee/crypto/lib/Identity';
import SidechainClient from '@ulixee/sidechain/lib/SidechainClient';
import { IAddressSignature, INote, NoteType } from '@ulixee/specification';
import Address from '@ulixee/crypto/lib/Address';
import { ISidechainApiTypes } from '@ulixee/specification/sidechain';
import config from '../config';
import MainchainBlock from '../main/models/MainchainBlock';
import Security from '../main/models/Security';
import MainDb from '../main/db';
import { serverPort } from './_TestServer';
import { INoteRecord } from '../main/models/Note';

export default class TestClient extends SidechainClient {
  public get internalCredentials(): {
    address?: Address;
    identity?: Identity;
  } {
    return this.credentials;
  }

  constructor(privateKey?: Identity) {
    const identity = privateKey ?? Identity.createSync();
    super(`http://127.0.0.1:${serverPort()}`, {
      identity,
      address: Address.createFromSigningIdentities([identity]),
    });
  }

  public async isRegistered() {
    return MainDb.transaction(async client => {
      const { rows } = await client.query('SELECT 1 from addresses WHERE address = $1 LIMIT 1', [
        this.address,
      ]);
      return rows.length >= 1;
    });
  }

  // make public
  public override async runSignedByAddress<T extends keyof ISidechainApiTypes & string>(
    command: T,
    args: Omit<ISidechainApiTypes[T]['args'], 'signature'>,
    retries = 5,
  ): Promise<ISidechainApiTypes[T]['result']> {
    return super.runSignedByAddress(command, args);
  }

  // make public
  public override async runRemote<T extends keyof ISidechainApiTypes & string>(
    command: T,
    args: ISidechainApiTypes[T]['args'],
    retries = 5,
  ): Promise<ISidechainApiTypes[T]['result']> {
    return super.runRemote(command, args);
  }

  // make public
  public override async runSignedByIdentity<T extends keyof ISidechainApiTypes & string>(
    command: T,
    args: Omit<ISidechainApiTypes[T]['args'], 'signature'>,
    retries = 5,
  ): Promise<ISidechainApiTypes[T]['result']> {
    return super.runSignedByIdentity(command, args);
  }

  public async grantCentagons(centagons: bigint | number, guaranteeBlockHeight = 0) {
    centagons = BigInt(centagons);
    return await MainDb.transaction(async client => {
      const transactionParams: Partial<INoteRecord> = {
        centagons: centagons as bigint,
        fromAddress: config.mainchain.addresses[0].bech32,
        toAddress: this.address,
        timestamp: new Date(),
        guaranteeBlockHeight,
        type: NoteType.transferIn,
      };
      transactionParams.noteHash = hashObject(transactionParams);

      const note = client.insert<INote>('notes', {
        ...transactionParams,
        signature: {
          signers: [],
          signatureSettings: { countRequired: 1, settingsMerkleProofs: [] },
        } as IAddressSignature,
        timestamp: transactionParams.timestamp,
      });
      if ((await MainchainBlock.getBlockHeight(sha3('block1'))) === null) {
        await new MainchainBlock(client, {
          height: 0,
          blockHash: sha3('block1'),
          nextLinkTarget: {
            powerOf2: 256,
          },
          isLongestChain: true,
        }).save();
      }

      await new Security(client, {
        centagons: centagons as bigint,
        transactionHash: transactionParams.noteHash,
        isToSidechain: true,
        transactionTime: new Date(),
        fromAddress: this.address,
        confirmedBlockHeight: 0,
        toAddress: config.mainchain.addresses[0].bech32,
        transactionOutputAddress: config.mainchain.addresses[0].bech32,
        transactionOutputIndex: 0,
        noteHash: transactionParams.noteHash,
        isBurn: false,
      }).save();

      return note;
    });
  }
}
