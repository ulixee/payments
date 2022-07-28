import Address from '@ulixee/crypto/lib/Address';
import Identity from '@ulixee/crypto/lib/Identity';

export default interface IBatchState {
  address: string;
  slug: string;
  credentials: { address: Address; identity: Identity };
  isClosed: boolean;
  isAllowingNewNotes: boolean;
  isSettled: boolean;
  settledTime: Date;
}
