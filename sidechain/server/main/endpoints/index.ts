import WalletGetBalance from './Address.getBalance';
import WalletRegister from './Address.register';
import FundingTransferKeys from './FundingTransfer.keys';
import FundingTransferOut from './FundingTransfer.out';
import FundingTransferStatus from './FundingTransfer.status';
import NoteCreate from './Note.create';
import NoteGet from './Note.get';
import StakeCreate from './Stake.create';
import StakeRefund from './Stake.refund';
import StakeSettings from './Stake.settings';
import StakeSignature from './Stake.signature';
import SidechainSettings from './Sidechain.settings';
import SidechainOpenBatches from './Sidechain.openBatches';

export default [
  WalletGetBalance,
  WalletRegister,
  FundingTransferKeys,
  FundingTransferOut,
  FundingTransferStatus,
  NoteCreate,
  NoteGet,
  StakeCreate,
  StakeRefund,
  StakeSettings,
  StakeSignature,
  SidechainSettings,
  SidechainOpenBatches,
];
