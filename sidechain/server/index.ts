import '@ulixee/commons/lib/SourceMapSupport';
import config from './config';
import app from './app';
import Main from './main';

const port = config.port;

// make sure Batches are booted before starting server
(async function start() {
  await Main.start();

  const address = await app.start(port);
  if (!port) {
    config.baseUrl = `http://localhost:${address.port}`;
  }
})().catch(console.error);
