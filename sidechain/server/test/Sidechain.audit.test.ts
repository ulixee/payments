import { IAddressSignature, NoteType } from '@ulixee/specification';
import moment = require('moment');
import { start, stop } from './_setup';
import Client from './_TestClient';
import { cachedResult } from '../main/endpoints/Sidechain.audit';
import mainDb from '../main/db';
import Note, { INoteRecord } from '../main/models/Note';
import config from '../config';

beforeAll(async () => {
  await start();
});

afterAll(async () => {
  await stop();
});

test('should be able to generate a Sidechain audit', async () => {
  const client = new Client();
  const res = await client.runRemote('Sidechain.audit', undefined);
  expect(res.argonsInCirculation_e2).toBe(0n);
  expect(res.argonsBurnedYesterday_e2).toBe(0n);
});

test('should summarize all Sidechain Burns and Argons in circulation', async () => {
  cachedResult.value = null;
  await mainDb.transaction(async client => {
    await client.batchInsert<INoteRecord>('notes', [
      {
        fromAddress: config.nullAddress,
        toAddress: config.mainchain.addresses[0].bech32,
        centagons: 1100000n,
        guaranteeBlockHeight: 0,
        timestamp: moment().add(-1, 'days').toDate(),
        signature: { signers: [], signatureSettings: null } as IAddressSignature,
        noteHash: Buffer.from('1231'),
        type: NoteType.transferIn,
      },
      {
        fromAddress: config.mainchain.addresses[0].bech32,
        toAddress: config.nullAddress,
        guaranteeBlockHeight: 0,
        timestamp: moment().add(-1, 'days').toDate(),
        signature: { signers: [], signatureSettings: null } as IAddressSignature,
        centagons: 100n,
        noteHash: Buffer.from('1232'),
        type: NoteType.burn,
      },
      {
        fromAddress: config.mainchain.addresses[0].bech32,
        toAddress: config.nullAddress,
        guaranteeBlockHeight: 0,
        timestamp: moment().add(-2, 'days').toDate(),
        signature: { signers: [], signatureSettings: null } as IAddressSignature,
        centagons: 80n,
        noteHash: Buffer.from('1233'),
        type: NoteType.burn,
      },
      {
        fromAddress: config.mainchain.addresses[0].bech32,
        toAddress: config.nullAddress,
        guaranteeBlockHeight: 0,
        timestamp: moment().add(-3, 'days').toDate(),
        signature: { signers: [], signatureSettings: null } as IAddressSignature,
        centagons: 60n,
        noteHash: Buffer.from('1234'),
        type: NoteType.burn,
      },
    ]);
  });
  const client = new Client();
  const res = await client.runRemote('Sidechain.audit', undefined);
  // subtract burn from transfer in
  expect(res.argonsInCirculation_e2).toBe(1100000n - 100n - 80n - 60n);
  expect(res.argonsBurnedYesterday_e2).toBe(100n);
  // 240 / 30 days
  expect(res.argonsBurnedRolling30DayAverage_e2).toBe(8n);
});
