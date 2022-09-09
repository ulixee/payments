import '@ulixee/commons/lib/SourceMapSupport';
import config from './config';
import BlockLookup from './lib/BlockLookup';
import { createServer } from './endpoints';

(async () => {
  const blockLookup = new BlockLookup();
  const server = createServer(blockLookup);
  const address = await server.start(config.port);
  config.port ??= address.port;
})().catch(console.error);
