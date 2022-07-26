import Identity from '@ulixee/crypto/lib/Identity';
import Client from './_TestClient';
import { mockGenesisTransfer, setupDb, stop } from './_setup';

beforeAll(async () => {
  await setupDb();
  await mockGenesisTransfer();
});

test('should not accept an invalid signature', async () => {
  const identity = await Identity.create();
  const identity2 = await Identity.create();
  Object.defineProperty(identity, 'bech32', {
    get(): any {
      return identity2.bech32;
    },
  });
  const client = new Client(identity);
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
