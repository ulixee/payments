import PgPool, { DbType } from '@ulixee/payment-utils/pg/PgPool';
import config from '../config';

const MainDb = new PgPool<DbType.Main>(config.mainDatabase, config.db);

export default MainDb;
