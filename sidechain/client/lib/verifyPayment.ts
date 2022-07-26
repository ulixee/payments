import { InvalidSignatureError } from '@ulixee/crypto/lib/errors';
import { IPayment } from '@ulixee/specification';
import { UnapprovedSidechainError } from '@ulixee/commons/lib/errors';
import Keypair from '@ulixee/crypto/lib/Keypair';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { InvalidPaymentBlockHeightError } from './errors';

export default function verifyPayment(
  approvedSidechains: IPublicKeyed[],
  payment: IPayment,
  currentBlockHeight: number,
): void {
  const {
    micronoteId,
    microgons,
    blockHeight,
    micronoteSignature,
    micronoteBatchPublicKey,
    sidechainPublicKey,
    sidechainValidationSignature,
  } = payment;

  if (Math.abs(currentBlockHeight - blockHeight) > 2) {
    throw new InvalidPaymentBlockHeightError(currentBlockHeight, blockHeight);
  }

  if (!approvedSidechains.find(x => x.rootPublicKey.equals(sidechainPublicKey))) {
    throw new UnapprovedSidechainError();
  }

  const isBatchValid = Keypair.verify(
    sidechainPublicKey,
    sha3(micronoteBatchPublicKey),
    sidechainValidationSignature,
  );
  if (isBatchValid === false) {
    throw new InvalidSignatureError(
      'The micronoteBatch server does not have a valid ledger public key validator. DO NOT TRUST!',
    );
  }

  const signatureMessage = sha3(`${micronoteId}${microgons}`);
  const isMicronoteValid = Keypair.verify(
    micronoteBatchPublicKey,
    signatureMessage,
    micronoteSignature,
  );
  if (isMicronoteValid === false) {
    throw new InvalidSignatureError(
      'The Payment micronoteId was not signed by this micronoteBatch with the preferred microgons',
    );
  }
}

interface IPublicKeyed {
  rootPublicKey: Buffer;
}
