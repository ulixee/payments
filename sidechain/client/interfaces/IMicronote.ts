import IMicronoteApis from '@ulixee/specification/sidechain/MicronoteApis';

type IMicronote = IMicronoteApis['Micronote.create']['result'] & {
  batchSlug: string;
  isCreditBatch: boolean;
  micronoteBatchUrl: string;
  micronoteBatchIdentity: string;
  sidechainIdentity: string;
  sidechainValidationSignature: Buffer;
};
export default IMicronote;
