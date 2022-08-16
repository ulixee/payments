import Identity from '@ulixee/crypto/lib/Identity';
import Address from '@ulixee/crypto/lib/Address';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import RemoteError from '@ulixee/net/errors/RemoteError';
import { ConnectionToCore } from '@ulixee/net';
import { encodeBuffer } from '@ulixee/commons/lib/bufferUtils';
import IMicronoteBatch from '@ulixee/specification/types/IMicronoteBatch';
import SidechainClient from '../lib/SidechainClient';
import MicronoteBatchFunding from '../lib/MicronoteBatchFunding';

const mock = {
  connectionToCore: {
    sendRequest: jest.spyOn(ConnectionToCore.prototype, 'sendRequest'),
  },
  MicronoteBatchFunding: {
    verifyBatch: jest.spyOn<any, any>(MicronoteBatchFunding.prototype, 'verifyBatch'),
    fundBatch: jest.spyOn(MicronoteBatchFunding.prototype, 'fundBatch'),
  },
  Identity: {
    verify: jest.spyOn(Identity, 'verify'),
  },
};

let batchSlug = 'micro_12345123';
let counter = 0;
beforeAll(() => {
  mock.Identity.verify.mockImplementation(() => true);

  mock.MicronoteBatchFunding.fundBatch.mockImplementation(async function (batch, centagons) {
    return this.recordBatchFund(1, centagons * 10e3, batch);
  });

  mock.connectionToCore.sendRequest.mockImplementation(async ({ command }) => {
    if (command === 'MicronoteBatch.findFund') {
      return {};
    }
    if (command === 'MicronoteBatch.get') {
      return {
        active: {
          batchSlug,
          micronoteBatchIdentity:
            '0241919c713a7fc1121988e4e2a244f1dfa7bfaa731ec23909a798b6d1001a73f8',
          sidechainIdentity: sha3('ledgerIdentity'),
          sidechainValidationSignature: 'batchPubKeySig',
        },
      };
    }
    if (command === 'Micronote.create') {
      counter += 1;
      if (counter === 404) {
        batchSlug = 'micro_12345126';
        throw new RemoteError({
          code: 'ERR_NOT_FOUND',
        });
      }

      return {
        batchSlug,
        id: Buffer.from('micronoteId'),
        blockHeight: 1,
        micronoteSignature: Buffer.from('noteSig'),
      };
    }
    throw new Error(`unknown request ${command}`);
  });
});

beforeEach(() => {
  mock.MicronoteBatchFunding.verifyBatch.mockClear();
  mock.MicronoteBatchFunding.fundBatch.mockClear();
  mock.connectionToCore.sendRequest.mockClear();
});

test('should fund a micronote batch if needed', async () => {
  const clientIdentity = await Identity.create();
  const address = Address.createFromSigningIdentities([clientIdentity]);

  const sidechain = new SidechainClient('https://nobody.nil/', { address });
  counter = 0;

  const note = await sidechain.createMicronote(10);
  expect(mock.connectionToCore.sendRequest).toHaveBeenCalledTimes(3);
  expect(mock.MicronoteBatchFunding.fundBatch).toHaveBeenCalledTimes(1);
  expect(note.id).toEqual(Buffer.from('micronoteId'));
  expect(note.micronoteBatchUrl).toBe('https://nobody.nil/micro_12345123');
  expect(note.sidechainIdentity).toEqual(sha3('ledgerIdentity'));
});

test('should reuse a current micronote batch fund if one is set', async () => {
  const clientIdentity = await Identity.create();
  const address = Address.createFromSigningIdentities([clientIdentity]);

  const sidechain = new SidechainClient('https://nobody.nil/', { address });
  counter = 0;
  const note = await sidechain.createMicronote(10);
  expect(note.micronoteBatchUrl).toBe('https://nobody.nil/micro_12345123');
  expect(mock.MicronoteBatchFunding.fundBatch).toHaveBeenCalledTimes(1);

  // should re-use the current micronoteBatch if one is set
  const note2 = await sidechain.createMicronote(20);
  // should have only created one micronoteBatch
  expect(mock.MicronoteBatchFunding.fundBatch).toHaveBeenCalledTimes(1);
  expect(note2.micronoteBatchUrl).toBe('https://nobody.nil/micro_12345123');
});

test('should handle a failing/shutting down micronoteBatch', async () => {
  const clientIdentity = await Identity.create();
  const address = Address.createFromSigningIdentities([clientIdentity]);

  const sidechain = new SidechainClient('https://nobody.nil/', { address });
  counter = 0;
  const note = await sidechain.createMicronote(10);
  expect(note.micronoteBatchUrl).toBe('https://nobody.nil/micro_12345123');

  counter = 403;
  const note2 = await sidechain.createMicronote(10);
  // new host path
  expect(note2.micronoteBatchUrl).toBe('https://nobody.nil/micro_12345126');
});

test('should only create a new micronote fund if funds are exhausted', async () => {
  const clientIdentity = await Identity.create();
  const address = Address.createFromSigningIdentities([clientIdentity]);

  // setup by funding a micronote
  const sidechain = new SidechainClient('https://nobody.nil/', { address });
  counter = 0;
  await sidechain.createMicronote(10);
  expect(mock.MicronoteBatchFunding.fundBatch).toHaveBeenCalledTimes(1);
  mock.connectionToCore.sendRequest.mockClear();
  mock.MicronoteBatchFunding.fundBatch.mockClear();

  // now check how many times we try to fill up
  let microgonsRemaining = 80;
  const batch = {
    batchSlug,
    isGiftCardBatch: false,
  } as IMicronoteBatch;
  mock.MicronoteBatchFunding.fundBatch.mockImplementation(async function (_, centagons) {
    microgonsRemaining = centagons * 10e3;
    await this.recordBatchFund(counter, centagons * 10e3, batch);
    await new Promise(resolve => setTimeout(resolve, 200));
    return { fundsId: counter, batchSlug, microgonsRemaining };
  });

  mock.connectionToCore.sendRequest.mockImplementation(async ({ command, args }) => {
    const params = args?.[0] as any;
    if (command === 'MicronoteBatch.findFund') {
      if (microgonsRemaining < params.microgons) {
        return {};
      }
      return { fundsId: counter, microgonsRemaining };
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    if (command === 'Micronote.create') {
      counter += 1;

      const microgons = params.microgons;
      // make 4 of the requests run twice (only one should prompt a new fund)
      if (counter <= 4 || microgonsRemaining < microgons) {
        throw new RemoteError({
          code: 'ERR_NEEDS_BATCH_FUNDING',
          data: {
            minCentagonsNeeded: 100,
          },
        });
      }

      microgonsRemaining -= microgons;

      return {
        batchSlug,
        id: Buffer.from('micronoteId'),
        blockHeight: 1,
        micronoteSignature: Buffer.from('noteSig'),
      };
    }
    throw new Error(`unknown request ${command}`);
  });

  // should re-use the current micronoteBatch if one is set
  await Promise.all([
    sidechain.createMicronote(20),
    sidechain.createMicronote(10),
    sidechain.createMicronote(20),
    sidechain.createMicronote(10),
    sidechain.createMicronote(20),
    sidechain.createMicronote(10),
  ]);

  expect(counter).toEqual(6 + 4 + 1);
  // should keep reusing the one with funds left
  expect(mock.MicronoteBatchFunding.fundBatch).toHaveBeenCalledTimes(1);
});

test('should only get funds one at a time', async () => {
  const clientIdentity = await Identity.create();
  const address = Address.createFromSigningIdentities([clientIdentity]);

  const sidechain = new SidechainClient('https://nobody.nil/', { address });
  sidechain.micronoteBatchFunding.queryFundingToPreload = 1;
  let fundCounter = 0;
  mock.connectionToCore.sendRequest.mockClear();
  mock.MicronoteBatchFunding.fundBatch.mockRestore();

  let firstBatch = {
    fundsId: 5222,
    microgonsRemaining: 11000,
  };

  mock.connectionToCore.sendRequest.mockImplementation(async ({ command }) => {
    if (command === 'MicronoteBatch.findFund') {
      if (firstBatch) {
        const result = { ...firstBatch };
        firstBatch = null;
        return result;
      }
      return {};
    }
    if (command === 'MicronoteBatch.fund') {
      fundCounter += 1;
      return { fundsId: fundCounter };
    }
    if (command === 'MicronoteBatch.get') {
      return {
        active: {
          batchSlug,
          micronoteBatchIdentity:
            '0241919c713a7fc1121988e4e2a244f1dfa7bfaa731ec23909a798b6d1001a73f8',
          micronoteBatchAddress: encodeBuffer(Buffer.from(sha3('12234')), 'ar'),
          sidechainIdentity: sha3('ledgerIdentity'),
          sidechainValidationSignature: 'batchPubKeySig',
        },
      };
    }

    throw new Error(`unknown request ${command}`);
  });

  const promises = [];
  for (let i = 0; i < 100; i += 1) {
    promises.push(sidechain.micronoteBatchFunding.reserveFunds(1000));
  }
  await Promise.all(promises);
  // should use the existing batch to start
  expect(fundCounter).toBe(9);

  const funding = sidechain.micronoteBatchFunding;
  // @ts-expect-error
  const remaining = funding.fundsByIdPerBatch[batchSlug][funding.activeFundsId];
  expect(remaining.microgonsRemaining).toBe(1000);
}, 10e3);
