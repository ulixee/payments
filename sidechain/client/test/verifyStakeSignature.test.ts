import Identity from '@ulixee/crypto/lib/Identity';
import * as Helpers from './_helpers'
import verifyStakeSignature from '../lib/verifyStakeSignature';

test('should verify a stake signature', async () => {
  const identity = Identity.createSync();
  const sig = Helpers.getStakeSignature(identity.bech32);
  const isValid = await verifyStakeSignature(1, identity.bech32, sig, {
    isSidechainApproved: async () => true,
  });
  expect(isValid).toBe(true);
});

test('should reject a stake signature that is too old', async () => {
  const identity = Identity.createSync();
  const sig = Helpers.getStakeSignature(identity.bech32, 5);
  const isValid = await verifyStakeSignature(10, identity.bech32, sig, {
    isSidechainApproved: async () => true,
  });
  expect(isValid).toBe(false);
});
