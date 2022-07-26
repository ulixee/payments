import Keypair from '@ulixee/crypto/lib/Keypair';
import Client from './_TestClient';
import { mockGenesisTransfer, setupDb, stop } from './_setup';

beforeAll(async () => {
  await setupDb();
  await mockGenesisTransfer();
});

test('should not accept an invalid signature', async () => {
  const keys = await Keypair.create();
  const keys2 = await Keypair.create();
  Object.defineProperty(keys, 'publicKey', {
    get(): any {
      return keys2.publicKey;
    },
  });
  const client = new Client(keys);
  const result = await client.register().catch(err => err);
  expect(result.code).toBe('ERR_PERMISSIONS');
});

test('should accept a valid signature', async () => {
  const client = new Client();
  const res = await client.register();
  expect(res).toBeTruthy();
});

afterAll(async () => {
  await stop();
}, 10e3);
