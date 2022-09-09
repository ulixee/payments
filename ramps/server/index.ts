import '@ulixee/commons/lib/SourceMapSupport';
import config from './config';
import { createServer } from './endpoints';
import RampApp from './lib/RampApp';

(async function start() {
  await RampApp.start();

  const server = createServer();
  const address = await server.start(config.port);

  const listenPort = address.port;
  if (!config.port && listenPort !== 443) {
    config.baseUrl = `http://localhost:${listenPort}`;
  }
})().catch(console.error);
