import { ISidechainApiTypes } from '@ulixee/specification/sidechain';
import { verifyMessage } from 'ethers/lib/utils';
import USDCApi from '../lib/USDCApi';
import RampAudit from '../models/RampAudit';

/**
 * Function illustrating how to validate the Ramp Audit results.
 *
 * 1. Is there enough in total reserves to allow all argons to be converted out.
 * 2. Are all addresses holding the claimed balances.
 * 3. Are all addresses owned.
 */
export default async function validateAudit(
  audit: ISidechainApiTypes['Ramp.audit']['result'],
): Promise<{ issues: string[]; isValid: boolean }> {
  const {
    argonsInCirculation_e6: argonsInCirculation,
    usdcToArgonConversionRate,
    usdcReserves_e6: usdcReserves,
  } = audit;

  const auditDate = audit.auditDate.toISOString().split('T').shift();
  const issues: string[] = [];

  const argonsInUSD = BigInt(Number(argonsInCirculation) / usdcToArgonConversionRate);

  if (argonsInUSD < usdcReserves) {
    issues.push(
      `USDC reserves are not sufficient for the Argon Circulation!! 

This could be due to inflation out-pacing data usage, or it could be due to insufficient reserves.`,
    );
  }

  const signatureMessage = RampAudit.signatureMessage({
    ...audit,
    usdcReservesE6: usdcReserves,
    argonsInCirculationE6: argonsInCirculation,
  });

  let addressBalances = 0n;
  for (const reserve of audit.usdcReserveAddresses) {
    const client = new USDCApi(reserve.blockchain, reserve.blockchainNetwork);
    addressBalances += await client.getBalanceOf(reserve.address);

    const addressSigner = verifyMessage(signatureMessage, reserve.ownershipProof);
    if (addressSigner !== reserve.address) {
      issues.push(
        `The signature of this audit provided by one of the reserve accounts is invalid (address=${reserve.address}, blockchain=${reserve.blockchain}).`,
      );
    }
  }

  if (addressBalances < usdcReserves) {
    issues.push(
      `The stated USDC Reserves (${addressBalances.toString()}) is less than the balance held by the provided Addresses (${usdcReserves.toString()}).
       
NOTE: This could indicate foul play, or simply that account balances have moved since the audit date (${auditDate}). If this remains an issue for multiple audits in a row, something is wrong.`,
    );
  }
  return { issues, isValid: !issues.length };
}
