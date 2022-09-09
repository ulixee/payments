import moment = require('moment');
import PgClient from '@ulixee/payment-utils/pg/PgClient';
import { DbType } from '@ulixee/payment-utils/pg/PgPool';
import RampApp from '../lib/RampApp';
import USDCApi from '../lib/USDCApi';
import config from '../config';
import EthereumHDWallet, { IHDWalletMeta } from '../lib/EthereumHDWallet';

export default class RampAudit {
  public static table = 'ramp_audits';

  public data: IRampAudit;

  public static async latestSignedAudit(client: PgClient<DbType.Ramp>): Promise<IRampAudit> {
    const result = await client.query<IRampAudit>(
      `select * from ${this.table} where signatures_complete_date is not null order by audit_date desc LIMIT 1`,
    );
    return result.rows[0];
  }

  public static async latestAudit(client: PgClient<DbType.Ramp>): Promise<IRampAudit> {
    const result = await client.query<IRampAudit>(
      `select * from ${this.table} order by audit_date desc LIMIT 1`,
    );
    return result.rows[0];
  }

  public static async createAudit(
    client: PgClient<DbType.Ramp>,
    usdcToArgonConversionRate: number,
    centagonsInCirculation: bigint,
  ): Promise<IRampAudit> {
    const auditDate = moment().startOf('day').toDate();
    const existing = await client.query<IRampAudit>(
      `select 1 from ${this.table} where audit_date=$1`,
      [auditDate],
    );
    if (existing.rows.length) return existing.rows[0];

    const reserveWallets = config.neuteredHDWalletsForReserves;

    const apiClientsByNetwork: { [blockchain_network: string]: USDCApi<any> } = {};
    const balances = await Promise.all(
      reserveWallets.map(wallet => {
        const x = wallet.meta;
        const apiKey = `${x.blockchain}_${x.blockchainNetwork}`;
        apiClientsByNetwork[apiKey] ??= new USDCApi(x.blockchain, x.blockchainNetwork);

        return apiClientsByNetwork[apiKey].getBalanceOf(wallet.address);
      }),
    );
    return client.insert<IRampAudit>(this.table, {
      auditDate,
      usdcAddresses: reserveWallets.map(
        x =>
          <IRampAudit['usdcAddresses'][0]>{
            address: x.address,
            nodePath: x.path,
            ...x.meta,
          },
      ),
      usdcReservesE6: balances.reduce((a, b) => a + b, 0n),
      usdcToArgonConversionRate,
      argonsInCirculationE6: centagonsInCirculation * BigInt(1e4),
      proofOfUsdcAddressCustody: reserveWallets.map(() => null), // empty slots
    });
  }

  public static signatureMessage(audit: {
    auditDate: Date;
    argonsInCirculationE6: bigint;
    usdcReservesE6: bigint;
    usdcToArgonConversionRate: number;
  }): Buffer {
    // NOTE: Ethereum will use keccak to hash the signature message, not sha3-256
    return Buffer.from(
      `Ulixee/Ramp.audit::${[
        audit.auditDate.toISOString(),
        audit.usdcReservesE6.toString(),
        audit.argonsInCirculationE6.toString(),
        audit.usdcToArgonConversionRate.toFixed(3),
      ].join('_')}`,
    );
  }

  public static async signAudits(wallet: EthereumHDWallet<any>): Promise<IRampAudit[]> {
    return await RampApp.db.transaction(async client => {
      const needingSignatures = await client.list<IRampAudit>(
        `select * from ${this.table} where signatures_complete_date is null`,
      );
      for (const audit of needingSignatures) {
        // NOTE: Ethereum will use keccak to hash the signature message, not sha3-256
        const signatureMessage = this.signatureMessage(audit);

        const indexSignatures: [index: number, signature: string][] = [];
        for (let index = 0; index < audit.usdcAddresses.length; index += 1) {
          if (!audit.proofOfUsdcAddressCustody[index]) {
            const rootWalletGuid = audit.usdcAddresses[index]?.rootWalletGuid;
            const canSign = wallet.meta.rootWalletGuid === rootWalletGuid;
            if (!canSign) continue;
            const nestedWallet = wallet.deriveChild(audit.usdcAddresses[index].nodePath);
            const signature = await nestedWallet.wallet.signMessage(signatureMessage);
            indexSignatures.push([index, signature]);
          }
        }

        // Lock the audit in an inner transaction to update in case we have concurrent signers
        await RampApp.db.transaction(async innerClient => {
          const lockedAudit = await innerClient.queryOne<{ proofOfUsdcAddressCustody: string[] }>(
            `select proof_of_usdc_address_custody from ${this.table} where audit_date=$1 FOR UPDATE LIMIT 1`,
            [audit.auditDate],
          );
          let completeDate = null;
          for (const [index, signature] of indexSignatures) {
            lockedAudit.proofOfUsdcAddressCustody[index] = signature;
            // update return value
            audit.proofOfUsdcAddressCustody[index] = signature;
          }
          if (!lockedAudit.proofOfUsdcAddressCustody.some(x => !x)) {
            completeDate = new Date();
            audit.signaturesCompleteDate = completeDate;
          }

          await innerClient.query(
            `update ${this.table} set proof_of_usdc_address_custody=$1,signatures_complete_date=$2  where audit_date=$3`,
            [lockedAudit.proofOfUsdcAddressCustody, completeDate, audit.auditDate],
          );
        });
      }
      return needingSignatures;
    });
  }
}

export interface IRampAudit {
  auditDate: Date;
  usdcAddresses: (IHDWalletMeta<any> & { nodePath: string; address: string })[];
  usdcReservesE6: bigint;
  usdcToArgonConversionRate: number;
  argonsInCirculationE6: bigint;
  proofOfUsdcAddressCustody: string[];
  signaturesCompleteDate?: Date;
}
