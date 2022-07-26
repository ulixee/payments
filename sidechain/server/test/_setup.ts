import Log from '@ulixee/commons/lib/Logger';
import { NoteType } from '@ulixee/specification';
import * as Postgrator from 'postgrator';
import * as pg from 'pg';
import config from '../config';
import { NotFoundError } from '../lib/errors';
import MicronoteBatchManager from '../lib/MicronoteBatchManager';
import Note from '../models/Note';
import db from '../lib/defaultDb';
import * as TestServer from './_TestServer';
import MicronoteBatchDb from '../lib/MicronoteBatchDb';

const sidechainWallet = config.mainchain.wallets[0];
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
      migrationPattern: `${__dirname}/../db-migrations-default/*.sql`,
      // Driver: must be pg, mysql, or mssql
      driver: 'pg',
      schemaTable: 'migrations',
      execQuery: query => migrationClient.query(query),
    });

    await migrator.migrate();
    await migrationClient.end();

    await db.transaction(async client => {
      await client.insert('wallets', { address: sidechainWallet.address });
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
    // @ts-ignore
    await MicronoteBatchManager.openBatches.clear();
    // @ts-ignore
    await MicronoteBatchManager.batchesPendingSettlement.clear();
    await db.transaction(async client => {
      await client.query(
        'TRUNCATE wallets, notes, micronote_batch_outputs, micronote_batches, mainchain_blocks, securities, stakes, stake_history, security_mainchain_blocks, funding_transfers_out, mainchain_transactions CASCADE',
      );
      await client.insert('wallets', { address: sidechainWallet.address });
    });
    return TestServer.serverPort();
  } catch (err) {
    console.log('error ', err);
    throw err;
  }
}

export async function mockGenesisTransfer() {
  await db.transaction(async client => {
    const note = Note.addSignature(
      {
        fromAddress: nullAddress,
        toAddress: sidechainWallet.address,
        centagons: BigInt(10e6),
        timestamp: new Date(),
        type: NoteType.transferIn,
      },
      sidechainWallet,
    );
    note.signature = {} as any;
    await new Note(client, note).saveUnchecked(0);
  });
}

export async function grantCentagons(centagons: number | bigint, toAddress: string) {
  await db.transaction(async client => {
    const data = Note.addSignature(
      {
        toAddress,
        fromAddress: sidechainWallet.address,
        centagons: BigInt(centagons),
        timestamp: new Date(),
        type: NoteType.transfer,
      },
      sidechainWallet,
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
    await db.query(`DROP DATABASE ${MicronoteBatchDb.getName(batch.slug)} WITH (FORCE);`);
  } catch (err) {
    if (!(err instanceof NotFoundError)) {
      logger.info('ERROR stopping service', err);
    }
  }
  await db.shutdown();
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
