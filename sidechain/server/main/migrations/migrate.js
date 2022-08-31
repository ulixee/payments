// eslint-disable-next-line import/no-extraneous-dependencies
const Postgrator = require('postgrator');
const pg = require('pg');
const config = require('../../config');

const client = new pg.Client({ ...config.db, database: config.mainDatabase });

const postgrator = new Postgrator({
  migrationPattern: `${__dirname}/*.sql`,
  driver: 'pg',
  database: config.mainDatabase,
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
