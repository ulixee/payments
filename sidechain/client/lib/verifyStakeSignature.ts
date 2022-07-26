import Log from '@ulixee/commons/lib/Logger';
import { IStakeSignature } from '@ulixee/specification';
import Identity from '@ulixee/crypto/lib/Identity';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer } from '@ulixee/commons/lib/bufferUtils';

const { log } = Log(module);

export default async function verifyStakeSignature(
  jobBlockHeight: number,
  identity: string,
  signature: IStakeSignature,
  sidechainApprover: ISidechainApprovalLookup,
): Promise<boolean> {
  const isSidechainApproved = await sidechainApprover.isSidechainApproved(
    signature.rootIdentity,
    jobBlockHeight,
  );
  if (isSidechainApproved === false) {
    log.info('UnapprovedSidechainUsed', {
      signature,
      identity,
      sessionId: null,
    });
    return false;
  }

  if (!signature || Math.abs(signature.blockHeight - jobBlockHeight) > 2) {
    log.info('InvalidStakeSignatureHeight', {
      signature,
      identity,
      sessionId: null,
    });
    return false;
  }

  const isValidSignature = Identity.verify(
    signature.rootIdentity,
    sha3(concatAsBuffer(identity, signature.blockHeight)),
    signature.signature,
  );
  if (isValidSignature === false) {
    log.info('InvalidStakeSignature', {
      signature,
      identity,
      sessionId: null,
    });
    return false;
  }
  return true;
}

interface ISidechainApprovalLookup {
  isSidechainApproved: (identity: string, blockHeight: number) => Promise<boolean>;
}
