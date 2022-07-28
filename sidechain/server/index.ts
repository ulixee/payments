import '@ulixee/commons/lib/SourceMapSupport';
import Log from '@ulixee/commons/lib/Logger';
import { createTerminus, HealthCheckError } from '@godaddy/terminus';
import * as http from 'http';
import config from './config';
import app from './app';
import MicronoteBatchManager from './main/lib/MicronoteBatchManager';
import BlockManager from './main/lib/BlockManager';
import MainDb from './main/db';

const { log } = Log(module);

log.info('STARTING SERVER');
const port = config.port;

const server = createTerminus(http.createServer(app), {
  timeout: 10000,
  logger(msg, error) {
    if (error) log.error(msg, { error, sessionId: null });
    else log.info(msg);
  },
  signals: ['SIGINT', 'SIGTERM', 'exit', 'SIGQUIT'],
  healthChecks: {
    async db() {
      try {
        await MainDb.healthCheck();
      } catch (err) {
        throw new HealthCheckError('Health check failed', [err.toString()]);
      }
    },
  },
  async onSignal() {
    log.info('SERVER EVENT: server is starting cleanup');
    await MicronoteBatchManager.stop();
    await BlockManager.stop();
    return await MainDb.shutdown();
  },
});

// make sure Batches are booted before starting server
(async function start() {
  await BlockManager.start();
  await MicronoteBatchManager.start();
  server.listen(port, () => {
    log.info('Sidechain started', { port, sessionId: null });
  });
})().catch(log.error);
