import { ICreateMicronoteResponse } from '@ulixee/specification/sidechain/MicronoteApis';

export default interface IMicronote extends ICreateMicronoteResponse {
  micronoteBatchUrl: string;
  micronoteBatchPublicKey: Buffer;
  sidechainPublicKey: Buffer;
  sidechainValidationSignature: Buffer;
}
