import { InvalidSignatureError } from '@ulixee/crypto/lib/errors';
import { IPayment } from '@ulixee/specification';
import { UnapprovedSidechainError } from '@ulixee/commons/lib/errors';
import Identity from '@ulixee/crypto/lib/Identity';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer } from '@ulixee/commons/lib/bufferUtils';
import IAuthorizedSidechain from '@ulixee/specification/types/IAuthorizedSidechain';
import { InvalidPaymentBlockHeightError } from './errors';

export default function verifyPayment(
  approvedSidechains: IAuthorizedSidechain[],
  payment: IPayment,
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
  } = payment;

  if (Math.abs(currentBlockHeight - blockHeight) > 2) {
    throw new InvalidPaymentBlockHeightError(currentBlockHeight, blockHeight);
  }

  if (!approvedSidechains.find(x => x.rootIdentity === sidechainIdentity)) {
    throw new UnapprovedSidechainError();
  }

  const isBatchValid = Identity.verify(
    sidechainIdentity,
    sha3(micronoteBatchIdentity),
    sidechainValidationSignature,
  );
  if (isBatchValid === false) {
    throw new InvalidSignatureError(
      'The MicronoteBatch server does not have an Identity signed by an authorized Sidechain. DO NOT TRUST!',
    );
  }

  const signatureMessage = sha3(concatAsBuffer(micronoteId, microgons));
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
