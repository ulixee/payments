import { hashObject, sha3 } from '@ulixee/commons/lib/hashUtils';
import Keypair from '@ulixee/crypto/lib/Keypair';
import SidechainClient from '@ulixee/sidechain-client/lib/SidechainClient';
import { INote, IWalletSignature, NoteType } from '@ulixee/specification';
import Keyring from '@ulixee/crypto/lib/Keyring';
import { ISidechainApiTypes } from '@ulixee/specification/sidechain';
import config from '../config';
import MainchainBlock from '../models/MainchainBlock';
import Security from '../models/Security';
import db from '../lib/defaultDb';
import { serverPort } from './_TestServer';
import { INoteRecord } from '../models/Note';

export default class TestClient extends SidechainClient {
  public get keyring() {
    return this.credentials.keyring;
  }

  constructor(privateKey?: Keypair) {
    const keypair = privateKey ?? Keypair.createSync();
    super(`http://127.0.0.1:${serverPort()}`, {
      nodeKeypair: keypair,
      keyring: Keyring.createFromKeypairs([keypair]),
    });
  }

  public async isRegistered() {
    return db.transaction(async client => {
      const { rows } = await client.query('SELECT 1 from wallets WHERE address = $1 LIMIT 1', [
        this.address,
      ]);
      return rows.length >= 1;
    });
  }

  // make public
  public override async runSignedByWallet<T extends keyof ISidechainApiTypes & string>(
    command: T,
    args: Omit<ISidechainApiTypes[T]['args'], 'signature'>,
    retries = 5,
  ): Promise<ISidechainApiTypes[T]['result']> {
    return super.runSignedByWallet(command, args);
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
  public override async runSignedAsNode<T extends keyof ISidechainApiTypes & string>(
    command: T,
    args: Omit<ISidechainApiTypes[T]['args'], 'signature'>,
    retries = 5,
  ): Promise<ISidechainApiTypes[T]['result']> {
    return super.runSignedAsNode(command, args);
  }

  public async grantCentagons(centagons: bigint | number, guaranteeBlockHeight = 0) {
    centagons = BigInt(centagons);
    return await db.transaction(async client => {
      const transactionParams: Partial<INoteRecord> = {
        centagons: centagons as bigint,
        fromAddress: config.mainchain.wallets[0].address,
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
        } as IWalletSignature,
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
        toAddress: config.mainchain.wallets[0].address,
        transactionOutputAddress: config.mainchain.wallets[0].address,
        transactionOutputIndex: 0,
        noteHash: transactionParams.noteHash,
        isBurn: false,
      }).save();

      return note;
    });
  }
}
