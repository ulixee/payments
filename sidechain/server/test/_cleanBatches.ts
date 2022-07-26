import db from '../lib/defaultDb';
import MicronoteBatchDb from '../lib/MicronoteBatchDb';

export default async function cleanBatch() {
  const batches = await db.transaction(async client => {
    return client.list<{ dbName: string }>(`select datname as db_name FROM pg_database
WHERE datistemplate = false and datname like '${MicronoteBatchDb.batchNamePrefix}%'`);
  });

  for (const { dbName } of batches) {
    await db.query(`DROP database ${dbName}`);
  }
}
