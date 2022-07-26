import { from, to } from 'pg-copy-streams';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import Wallet from '../models/Wallet';
import MicronoteBatch from '../models/MicronoteBatch';
import MicronoteBatchOutput from '../models/MicronoteBatchOutput';
import defaultDb from "./defaultDb";
import PgClient from "./PgClient";
import { DbType } from "./PgPool";
import { InsufficientFundsError } from './errors';
import MicronoteBatchDb from "./MicronoteBatchDb";

export default class MicronoteBatchSettle {
  public static async run(batch: MicronoteBatch, logger: IBoundLog): Promise<void> {
    const micronoteBatchDb = await MicronoteBatchDb.get(batch.slug);

    // NOTE: funky transaction/loading matters here. Need to keep streams open and rollback appropriately
    await defaultDb.transaction(
      async defaultClient => {
        // lock first
        const lockedBatch = await MicronoteBatch.lock(defaultClient, batch.address);
        if (lockedBatch.isSettled) {
          batch.data.settledTime = lockedBatch.data.settledTime;
          defaultClient.logger.warn('Not settling micronoteBatch.  Already settled');
          return;
        }
        await micronoteBatchDb.transaction(async batchClient => {
          const batchOutput = await MicronoteBatchOutput.createFromMicronoteBatchDb(
            batchClient,
            defaultClient,
            batch.address,
          );

          // NOTE: stream while inner transaction is still open
          await MicronoteBatchSettle.saveToLedger(batchClient, defaultClient, batch);
          // save output details
          await batchOutput.save();
        });
        // now update state
        await batch.recordStateTime('settledTime');
      },
      { logger },
    );
  }

  private static async saveToLedger(
    batchClient: PgClient<DbType.Batch>,
    defaultClient: PgClient<DbType.Default>,
    batch: MicronoteBatch,
  ): Promise<void> {
    // lock wallet on ledger
    const batchWallet = new Wallet(defaultClient, batch.address);
    await batchWallet.lock();

    batchClient.logger.info('IMPORTING: Reading input stream into note logs', {
      micronoteBatch: batch.slug,
      sessionId: null,
    });

    await MicronoteBatchSettle.copyLedgerTransactions(batchClient, defaultClient);

    await batchWallet.load();

    if (batchWallet.balance < 0n) {
      throw new InsufficientFundsError(
        'The given changes would create a negative balance',
        batchWallet.balance.toString(),
      );
    }
  }

  private static async copyLedgerTransactions(
    batchClient: PgClient<DbType.Batch>,
    defaultClient: PgClient<DbType.Default>,
  ): Promise<void> {
    const outputStream = await batchClient.queryStream(to('COPY note_outputs TO STDOUT'));
    const inputStream = await defaultClient.queryStream(from('COPY notes FROM STDIN'));
    const donePromise = new Promise<void>((resolve, reject) => {
      const done = (err, success): void => {
        if (err) {
          defaultClient.logger.error('ERROR streaming records', err);
          return reject(err);
        }
        return resolve(success);
      };
      outputStream.once('error', done);
      inputStream.once('finish', done);
      inputStream.once('error', done);
    });
    outputStream.pipe(inputStream);
    await donePromise;
  }
}
