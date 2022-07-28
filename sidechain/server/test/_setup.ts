import Log from '@ulixee/commons/lib/Logger';
import { NoteType } from '@ulixee/specification';
import * as Postgrator from 'postgrator';
import * as pg from 'pg';
import config from '../config';
import { NotFoundError } from '../utils/errors';
import MicronoteBatchManager from '../main/lib/MicronoteBatchManager';
import Note from '../main/models/Note';
import MainDb from '../main/db';
import * as TestServer from './_TestServer';
import MicronoteBatchDb from '../batch/db';

const sidechainAddressCredentials = config.mainchain.addresses[0];
const sidechainAddress = sidechainAddressCredentials.bech32;
const nullAddress = config.nullAddress;
const { log: logger } = Log(module);

export async function setupDb() {
  try {
    await queryWithRootDb(`CREATE DATABASE ${config.db.database}`);

    const migrationClient = new pg.Client(config.db);
    await migrationClient.connect();

    const migrator = new Postgrator({
      ...config.db,
      // or a glob pattern to files
      migrationPattern: `${__dirname}/../main/migrations/*.sql`,
      // Driver: must be pg, mysql, or mssql
      driver: 'pg',
      schemaTable: 'migrations',
      execQuery: query => migrationClient.query(query),
    });

    await migrator.migrate();
    await migrationClient.end();

    await MainDb.transaction(async client => {
      await client.insert('wallets', { address: sidechainAddress });
    });

    await TestServer.start();
    return TestServer.serverPort();
  } catch (err) {
    console.log('error ', err);
    throw err;
  }
}

export async function cleanDb() {
  try {
    // @ts-expect-error
    await MicronoteBatchManager.openBatchesBySlug.clear();
    // @ts-ignore
    await MicronoteBatchManager.pendingSettlementBatchesBySlug.clear();
    await MainDb.transaction(async client => {
      await client.query(
        'TRUNCATE wallets, notes, micronote_batch_outputs, micronote_batches, mainchain_blocks, securities, stakes, stake_history, security_mainchain_blocks, funding_transfers_out, mainchain_transactions CASCADE',
      );
      await client.insert('wallets', { address: sidechainAddress });
    });
    return TestServer.serverPort();
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
    const batch = await MicronoteBatchManager.get();
    await MicronoteBatchManager.stop();
    const pool = await MicronoteBatchDb.get(batch.slug);
    await pool.shutdown();
    await MainDb.query(`DROP DATABASE ${MicronoteBatchDb.getName(batch.slug)} WITH (FORCE);`);
  } catch (err) {
    if (!(err instanceof NotFoundError)) {
      logger.info('ERROR stopping service', err);
    }
  }
  await MainDb.shutdown();
  await queryWithRootDb(`DROP DATABASE ${config.db.database} WITH (FORCE);`);
  await TestServer.close();
}

export async function queryWithRootDb(sql: string): Promise<any> {
  const root = new pg.Client({
    ...config.db,
    user: 'postgres',
    password: 'postgres',
    database: null,
  });
  try {
    await root.connect();
    await root.query(sql);
  } finally {
    await root.end();
  }
}
