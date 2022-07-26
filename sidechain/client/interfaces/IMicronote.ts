import { ICreateMicronoteResponse } from '@ulixee/specification/sidechain/MicronoteApis';

export default interface IMicronote extends ICreateMicronoteResponse {
  micronoteBatchUrl: string;
  micronoteBatchIdentity: string;
  sidechainIdentity: string;
  sidechainValidationSignature: Buffer;
}
