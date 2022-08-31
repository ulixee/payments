import '@ulixee/commons/lib/SourceMapSupport';
import Log from '@ulixee/commons/lib/Logger';
import { createTerminus, HealthCheckError } from '@godaddy/terminus';
import * as http from 'http';
import { AddressInfo } from 'net';
import config from './config';
import app from './app';
import Main from './main';
import Ramp from './ramps';

const { log } = Log(module);

log.info('STARTING SERVER');
const port = config.port;

// make sure Batches are booted before starting server
(async function start() {
  await Main.start();
  await Ramp.start();

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
          await Main.healthCheck();
        } catch (err) {
          throw new HealthCheckError('Health check failed', [err.toString()]);
        }
      },
    },
    async onSignal() {
      log.info('SERVER EVENT: server is starting cleanup');
      await Ramp.stop();
      await Main.stop();
    },
  });
  server.listen(port, () => {
    if (!port) {
      config.baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
    }
    log.info('Sidechain started', { port, sessionId: null });
  });
})().catch(error => log.error('Sidechain Start Error', { error } as any));
