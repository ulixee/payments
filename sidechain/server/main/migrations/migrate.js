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

(async () => {
  await client.connect();
  try {
    const applied = await postgrator.migrate();
    // eslint-disable-next-line no-console
    console.log('Completed', applied);
  } finally {
    await client.end();
  }
})().catch(console.error);
