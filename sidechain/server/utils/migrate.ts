import * as pg from 'pg';
import * as Postgrator from 'postgrator'; // eslint-disable-line import/no-extraneous-dependencies
import config from '../config';

export default async function migrate(database: string, migrationsPath: string): Promise<void> {
  const migrationClient = new pg.Client({ ...config.db, database });
  try {
    await migrationClient.connect();

    const migrator = new Postgrator({
      database,
      migrationPattern: `${migrationsPath}/*`,
      driver: 'pg',
      schemaTable: 'migrations',
      execQuery: query => migrationClient.query(query),
    });

    await migrator.migrate();
  } finally {
    await migrationClient.end();
  }
}
