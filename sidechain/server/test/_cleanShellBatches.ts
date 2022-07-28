import MicronoteBatch, { IMicronoteBatchRecord } from '../main/models/MicronoteBatch';
import MainDb from '../main/db';
import MicronoteBatchDb from '../batch/db';

void (async function cleanShellBatch() {
  const batches = await MainDb.transaction(async client => {
    const realBatches = await client.list<IMicronoteBatchRecord>('select * from micronote_batches');
    const dbs = realBatches.map(x =>
      MicronoteBatchDb.getName(MicronoteBatch.fromData(client, x).slug),
    );
    const returnList = await client.list<{
      dbName: string;
    }>(`select datname as db_name FROM pg_database
WHERE datistemplate = false and datname like '${MicronoteBatchDb.batchNamePrefix}%'`);
    return returnList.filter(x => !dbs.includes(x.dbName));
  });

  for (const { dbName } of batches) {
    await MainDb.query(`DROP database ${dbName}`);
  }
})();
