import { IBlockSettings as IBlockSettingsSpec } from '@ulixee/specification';

export default interface IBlockSettings extends IBlockSettingsSpec {
  isSidechainApproved: (rootPublicKey: Buffer) => Promise<boolean>;
}
