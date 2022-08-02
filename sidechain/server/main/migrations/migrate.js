// eslint-disable-next-line import/no-extraneous-dependencies
const Postgrator = require('postgrator');
const config = require('config');
const pg = require('pg');

const client = new pg.Client(config.get('db'));

const postgrator = new Postgrator({
  migrationPattern: `${__dirname}/*.sql`,
  driver: 'pg',
  database: config.get('db.database'),
  schemaTable: 'migrations',
  execQuery: query => client.query(query),
});

// postgrator.on('validation-started', migration => console.log('VALIDATION STARTED',migration));
// postgrator.on('validation-finished', migration => console.log('VALIDATION DONE',migration));
// postgrator.on('migration-started', migration => console.log('MIGRATION STARTED',migration));
// postgrator.on('migration-finished', migration => console.log('MIGRATION DONE',migration));

(async () => {
  const applied = await postgrator.migrate();
  // eslint-disable-next-line no-console
  console.log('Completed', applied);
  await client.release();
})().catch(console.error);
