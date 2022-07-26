import Log from '@ulixee/commons/lib/Logger';
import { IStakeSignature } from '@ulixee/specification';
import Keypair from '@ulixee/crypto/lib/Keypair';
import { sha3 } from '@ulixee/commons/lib/hashUtils';

const { log } = Log(module);

export default async function verifyStakeSignature(
  jobBlockHeight: number,
  publicKey: Buffer,
  signature: IStakeSignature,
  sidechainApprover: ISidechainApprovalLookup,
): Promise<boolean> {
  const isSidechainApproved = await sidechainApprover.isSidechainApproved(
    signature.rootPublicKey,
    jobBlockHeight,
  );
  if (isSidechainApproved === false) {
    log.info('UnapprovedSidechainUsed', {
      signature,
      publicKey,
      sessionId: null,
    });
    return false;
  }

  if (!signature || Math.abs(signature.blockHeight - jobBlockHeight) > 2) {
    log.info('InvalidStakeSignatureHeight', {
      signature,
      publicKey,
      sessionId: null,
    });
    return false;
  }

  const isValidSignature = Keypair.verify(
    signature.rootPublicKey,
    sha3(Buffer.concat([publicKey, Buffer.from(`${signature.blockHeight}`)])),
    signature.signature,
  );
  if (isValidSignature === false) {
    log.info('InvalidStakeSignature', {
      signature,
      publicKey,
      sessionId: null,
    });
    return false;
  }
  return true;
}

interface ISidechainApprovalLookup {
  isSidechainApproved: (publicKey: Buffer, blockHeight: number) => Promise<boolean>;
}
