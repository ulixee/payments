import { hashObject } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer } from '@ulixee/commons/lib/bufferUtils';
import Identity from '@ulixee/crypto/lib/Identity';
import { PermissionsError } from './errors';

export default function verifyAddressSignature(
  identity: string,
  payload: any,
  command: string,
  signature: Buffer,
): void {
  const messageHash = hashObject(payload, {
    prefix: concatAsBuffer(command, identity),
    ignoreProperties: ['signature'],
  });
  const isValid = Identity.verify(identity, messageHash, signature);
  if (!isValid) {
    throw new PermissionsError('Invalid signature provided');
  }
}
