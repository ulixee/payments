import Keypair from '@ulixee/crypto/lib/Keypair';
import { sha3 } from '@ulixee/commons/lib/hashUtils';

const micronoteBatchKeypair = Keypair.createSync();
const sidechainKeypair = Keypair.createSync();
const blockHeight = 1;

export function getStakeSignature(
  publicKey: Buffer,
  requestedBlockHeight?: number,
  sidechainKeys?: Keypair,
) {
  const sideKeypair = sidechainKeys ?? sidechainKeypair;
  const height = requestedBlockHeight ?? blockHeight;

  return {
    rootPublicKey: sideKeypair.publicKey,
    blockHeight: height,
    signature: sideKeypair.sign(sha3(Buffer.concat([publicKey, Buffer.from(`${blockHeight}`)]))),
  };
}
