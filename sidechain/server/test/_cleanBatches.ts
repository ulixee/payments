import MainDb from '../main/db';
import MicronoteBatchDb from '../batch/db';

export default async function cleanBatch() {
  const batches = await MainDb.transaction(async client => {
    return client.list<{ dbName: string }>(`select datname as db_name FROM pg_database
WHERE datistemplate = false and datname like '${MicronoteBatchDb.batchNamePrefix}%'`);
  });

  for (const { dbName } of batches) {
    await MainDb.query(`DROP database ${dbName}`);
  }
}
