import { loadEnv } from '@ulixee/commons/lib/envUtils';

loadEnv(process.cwd());
loadEnv(__dirname);
const env = process.env;
const settings = {
  sidechainHost: env.SIDECHAIN_HOST,
};
export default settings;
