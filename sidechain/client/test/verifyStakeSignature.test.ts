import Keypair from '@ulixee/crypto/lib/Keypair';
import * as Helpers from './_helpers'
import verifyStakeSignature from '../lib/verifyStakeSignature';

test('should verify a stake signature', async () => {
  const keypair = Keypair.createSync();
  const sig = Helpers.getStakeSignature(keypair.publicKey);
  const isValid = await verifyStakeSignature(1, keypair.publicKey, sig, {
    isSidechainApproved: async () => true,
  });
  expect(isValid).toBe(true);
});

test('should reject a stake signature that is too old', async () => {
  const keypair = Keypair.createSync();
  const sig = Helpers.getStakeSignature(keypair.publicKey, 5);
  const isValid = await verifyStakeSignature(10, keypair.publicKey, sig, {
    isSidechainApproved: async () => true,
  });
  expect(isValid).toBe(false);
});
