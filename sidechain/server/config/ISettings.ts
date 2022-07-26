import { PoolConfig } from 'pg';

export default interface ISettings {
  port?: number;
  db?: PoolConfig & {
    port?: number | string;
  };
  micronoteBatch?: {
    minimumFundingCentagons?: bigint;
    openMinutes?: number;
    stopNewNotesMinsBeforeClose?: number;
    minimumOpen?: number;
    payoutAddress?: string;
    settlementFeeMicrogons?: number;
    prefix?: string;
  };
  mainchain?: {
    host?: string;
    fundingHoldBlocks?: number;
    addresses?: string[];
  };
  rootIdentitySecretKey?: string;
  rootIdentityPath?: string;
  stakeAddress?: string;
}
