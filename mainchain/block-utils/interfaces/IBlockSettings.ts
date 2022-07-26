import { IBlockSettings as IBlockSettingsSpec } from '@ulixee/specification';

export default interface IBlockSettings extends IBlockSettingsSpec {
  isSidechainApproved: (rootIdentity: string) => Promise<boolean>;
}
