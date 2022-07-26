import config from '../config';
import PgPool, { DbType } from './PgPool';

const defaultDb = new PgPool<DbType.Default>(config.db.database, config.db);

export default defaultDb;
