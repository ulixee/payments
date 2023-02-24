import { InvalidSignatureError } from '@ulixee/crypto/lib/errors';
import { IMicronote } from '@ulixee/specification';
import Identity from '@ulixee/crypto/lib/Identity';
import { sha256 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer } from '@ulixee/commons/lib/bufferUtils';
import { InvalidPaymentBlockHeightError, UnapprovedSidechainError } from './errors';

export default function verifyMicronote(
  micronote: IMicronote,
  approvedSidechainIdentities: Set<string>,
  currentBlockHeight: number,
): void {
  const {
    micronoteId,
    microgons,
    blockHeight,
    micronoteSignature,
    micronoteBatchIdentity,
    sidechainIdentity,
    sidechainValidationSignature,
  } = micronote;

  if (Math.abs(currentBlockHeight - blockHeight) > 2) {
    throw new InvalidPaymentBlockHeightError(currentBlockHeight, blockHeight);
  }

  if (!approvedSidechainIdentities.has(sidechainIdentity)) {
    throw new UnapprovedSidechainError();
  }

  const isBatchValid = Identity.verify(
    sidechainIdentity,
    sha256(micronoteBatchIdentity),
    sidechainValidationSignature,
  );
  if (isBatchValid === false) {
    throw new InvalidSignatureError(
      'The MicronoteBatch server does not have an Identity signed by an authorized Sidechain. DO NOT TRUST!',
    );
  }

  const signatureMessage = sha256(concatAsBuffer(micronoteId, microgons));
  const isMicronoteValid = Identity.verify(
    micronoteBatchIdentity,
    signatureMessage,
    micronoteSignature,
  );
  if (isMicronoteValid === false) {
    throw new InvalidSignatureError(
      'The Payment micronoteId was not signed by this MicronoteBatch.',
    );
  }
}
