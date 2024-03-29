import { IAddressSignature } from '@ulixee/specification';
import { hashObject } from '@ulixee/commons/lib/hashUtils';
import AddressSignature from '@ulixee/crypto/lib/AddressSignature';
import { PermissionsError } from './errors';

export default function verifyAddressSignature(
  address: string,
  payload: object,
  command: string,
  signature: IAddressSignature,
  isClaim = true,
): void {
  const messageHash = hashObject(payload, {
    prefix: Buffer.from(command),
    ignoreProperties: ['signature'] as any,
  });
  let invalidSignatureReason: string;
  try {
    invalidSignatureReason = AddressSignature.verify(address, signature, messageHash, isClaim);
  } catch (error) {
    invalidSignatureReason = error.message;
  }
  if (invalidSignatureReason) {
    throw new PermissionsError(invalidSignatureReason);
  }
}
