import Log from '@ulixee/commons/lib/Logger';
import { NoteType } from '@ulixee/specification';
import * as pg from 'pg';
import { NotFoundError } from '@ulixee/payment-utils/lib/errors';
import migrate from '@ulixee/payment-utils/pg/migrate';
import config from '../config';
import MicronoteBatchManager from '../main/lib/MicronoteBatchManager';
import Note from '../main/models/Note';
import MainDb from '../main/db';
import * as TestServer from './_TestServer';
import MicronoteBatchDb from '../batch/db';
import SidechainMain from '../main';
import RegisteredAddress from '../main/models/RegisteredAddress';

const sidechainAddressCredentials = config.mainchain.addresses[0];
const sidechainAddress = sidechainAddressCredentials.bech32;
const nullAddress = config.nullAddress;
const { log: logger } = Log(module);

async function createAndMigrate(database: string, migrationsPath: string): Promise<void> {
  await queryWithRootDb(`CREATE DATABASE ${database}`);
  await migrate({ ...config.db, database }, migrationsPath);
}

export async function start(): Promise<number> {
  try {
    await createAndMigrate(config.mainDatabase, `${__dirname}/../main/migrations`);
    await MainDb.transaction(async client => {
      await new RegisteredAddress(client, sidechainAddress).create();
    });

    await MicronoteBatchManager.start();
    const address = await TestServer.start();
    return address.port;
  } catch (err) {
    console.log('error ', err);
    throw err;
  }
}

export async function cleanDb() {
  try {
    // @ts-ignore
    await MicronoteBatchManager.batchesBySlug.clear();
    await MainDb.transaction(async client => {
      await client.query(
        'TRUNCATE addresses, notes, micronote_batch_outputs, micronote_batches, mainchain_blocks, securities, stakes, stake_history, security_mainchain_blocks, funding_transfers_out, mainchain_transactions CASCADE',
      );
      await new RegisteredAddress(client, sidechainAddress).create();
    });
  } catch (err) {
    console.log('error ', err);
    throw err;
  }
}

export async function mockGenesisTransfer() {
  await MainDb.transaction(async client => {
    const note = Note.addSignature(
      {
        fromAddress: nullAddress,
        toAddress: sidechainAddress,
        centagons: BigInt(10e6),
        timestamp: new Date(),
        type: NoteType.transferIn,
      },
      sidechainAddressCredentials,
    );
    note.signature = {} as any;
    await new Note(client, note).saveUnchecked(0);
  });
}

export async function grantCentagons(centagons: number | bigint, toAddress: string) {
  await MainDb.transaction(async client => {
    const data = Note.addSignature(
      {
        toAddress,
        fromAddress: sidechainAddress,
        centagons: BigInt(centagons),
        timestamp: new Date(),
        type: NoteType.transfer,
      },
      sidechainAddressCredentials,
    );
    await new Note(client, data).saveUnchecked();
  });
}

export async function stop() {
  try {
    await TestServer.close();
    await SidechainMain.stop();
    await MicronoteBatchDb.close();

    // @ts-expect-error
    for (const batch of MicronoteBatchManager.batchesBySlug.values()) {
      await queryWithRootDb(`DROP DATABASE ${MicronoteBatchDb.getName(batch.slug)} WITH (FORCE);`);
    }
  } catch (err) {
    if (!(err instanceof NotFoundError)) {
      logger.info('ERROR stopping service', err);
    }
  }
  await MainDb.shutdown();
  await queryWithRootDb(`DROP DATABASE ${config.mainDatabase} WITH (FORCE);`);
}

export async function queryWithRootDb(sql: string): Promise<any> {
  const root = new pg.Client({
    ...config.db,
    user: 'postgres',
    password: 'postgres',
  });
  try {
    await root.connect();
    await root.query(sql);
  } finally {
    await root.end();
  }
}
