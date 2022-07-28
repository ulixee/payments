import config from '../config';
import PgPool, { DbType } from '../utils/PgPool';

const MainDb = new PgPool<DbType.Main>(config.db.database, config.db);

export default MainDb;
