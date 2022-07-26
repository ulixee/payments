import Identity from '@ulixee/crypto/lib/Identity';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer } from '@ulixee/commons/lib/bufferUtils';

const micronoteBatchIdentity = Identity.createSync();
const sidechainIdentity = Identity.createSync();
const blockHeight = 1;

export function getStakeSignature(
  identity: string,
  requestedBlockHeight?: number,
  sidechainKeys?: Identity,
) {
  const sideIdentity = sidechainKeys ?? sidechainIdentity;
  const height = requestedBlockHeight ?? blockHeight;

  return {
    rootIdentity: sideIdentity.bech32,
    blockHeight: height,
    signature: sideIdentity.sign(sha3(concatAsBuffer(identity, blockHeight))),
  };
}
