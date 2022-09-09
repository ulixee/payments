import * as pg from 'pg';
import * as Postgrator from 'postgrator'; // eslint-disable-line import/no-extraneous-dependencies

export default async function migrate(db: pg.ClientConfig, migrationsPath: string): Promise<void> {
  const migrationClient = new pg.Client(db);
  try {
    await migrationClient.connect();

    const migrator = new Postgrator({
      database: db.database,
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
