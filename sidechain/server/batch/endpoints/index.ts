import MicronoteClaim from './Micronote.claim';
import MicronoteCreate from './Micronote.create';
import MicronoteLock from './Micronote.lock';
import MicronoteBatchFund from './MicronoteBatch.fund';
import MicronoteBatchFindFund from './MicronoteBatch.findFund';
import MicronoteBatchActiveFunds from './MicronoteBatch.activeFunds';
import MicronoteBatchGetFundSettlement from './MicronoteBatch.getFundSettlement';
import GiftCardCreate from './GiftCard.create';
import GiftCardGet from './GiftCard.get';
import GiftCardSettleHold from './GiftCard.settleHold';
import GiftCardCreateHold from './GiftCard.createHold';

export default [
  MicronoteClaim,
  MicronoteCreate,
  MicronoteLock,
  MicronoteBatchFund,
  MicronoteBatchFindFund,
  MicronoteBatchActiveFunds,
  MicronoteBatchGetFundSettlement,
  GiftCardCreate,
  GiftCardGet,
  GiftCardCreateHold,
  GiftCardSettleHold,
];
