import { InvalidSignatureError } from '@ulixee/crypto/lib/errors';
import { IPayment } from '@ulixee/specification';
import { UnapprovedSidechainError } from '@ulixee/commons/lib/errors';
import Identity from '@ulixee/crypto/lib/Identity';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { InvalidPaymentBlockHeightError } from './errors';

export default function verifyPayment(
  approvedSidechains: IIdentityed[],
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
      'The micronoteBatch server does not have a valid ledger public key validator. DO NOT TRUST!',
    );
  }

  const signatureMessage = sha3(`${micronoteId}${microgons}`);
  const isMicronoteValid = Identity.verify(
    micronoteBatchIdentity,
    signatureMessage,
    micronoteSignature,
  );
  if (isMicronoteValid === false) {
    throw new InvalidSignatureError(
      'The Payment micronoteId was not signed by this micronoteBatch with the preferred microgons',
    );
  }
}

interface IIdentityed {
  rootIdentity: string;
}
