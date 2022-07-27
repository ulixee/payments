import { from, to } from 'pg-copy-streams';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import Wallet from '../models/Wallet';
import MicronoteBatch, { IMicronoteBatchRecord } from '../models/MicronoteBatch';
import MicronoteBatchOutput from '../models/MicronoteBatchOutput';
import defaultDb from './defaultDb';
import PgClient from './PgClient';
import { DbType } from './PgPool';
import { InsufficientFundsError } from './errors';
import MicronoteBatchDb from './MicronoteBatchDb';

export default class MicronoteBatchSettle {
  public static async run(batchAddress: string, logger: IBoundLog): Promise<IMicronoteBatchRecord> {
    const transactionOptions = { logger };

    // NOTE: funky transaction/loading matters here. Need to keep streams open and rollback appropriately
    return await defaultDb.transaction(async defaultClient => {
      // lock first
      const batch = await MicronoteBatch.lock(defaultClient, batchAddress);
      if (batch.isSettled) {
        defaultClient.logger.warn('Not settling micronoteBatch.  Already settled');
        return batch.data;
      }

      // lock wallet on ledger
      const wallet = new Wallet(defaultClient, batch.address);
      await wallet.lock();

      const micronoteBatchDb = await MicronoteBatchDb.get(batch.slug);
      await micronoteBatchDb.transaction(async batchClient => {
        const batchOutput = await MicronoteBatchOutput.createFromMicronoteBatchDb(
          batchClient,
          defaultClient,
          batch.address,
        );

        logger.info('IMPORTING: Reading input stream into note logs', {
          micronoteBatch: batch.slug,
        });

        // NOTE: stream while inner transaction is still open
        await this.pipeNoteOutputToLedger(batchClient, defaultClient);

        await wallet.load();

        if (wallet.balance < 0n) {
          throw new InsufficientFundsError(
            'The given changes would create a negative balance',
            wallet.balance.toString(),
          );
        }
        // save output details
        await batchOutput.save();
      });
      // now update state
      await batch.recordStateTime('settledTime');
      return batch.data;
    }, transactionOptions);
  }

  private static async pipeNoteOutputToLedger(
    batchClient: PgClient<DbType.Batch>,
    defaultClient: PgClient<DbType.Default>,
  ): Promise<void> {
    const outputStream = batchClient.queryStream(to('COPY note_outputs TO STDOUT'));
    const inputStream = defaultClient.queryStream(from('COPY notes FROM STDIN'));
    await new Promise<void>((resolve, reject) => {
      outputStream
        .pipe(inputStream.once('error', reject))
        .once('finished', resolve)
        .on('error', reject);
    });
  }
}
