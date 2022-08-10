import Log from '@ulixee/commons/lib/Logger';
import TypeSerializer from '@ulixee/commons/lib/TypeSerializer';
import { IncomingMessage, ServerResponse } from 'http';
import ApiRegistry from './utils/ApiRegistry';
import MainDb from './main/db';
import batchEndpoints from './batch/endpoints';
import mainEndpoints from './main/endpoints';
import MicronoteBatchManager from './main/lib/MicronoteBatchManager';
import BlockManager from './main/lib/BlockManager';

const packageJson = require('./package.json');

const { log } = Log(module);

ApiRegistry.registerEndpoints(...mainEndpoints);
ApiRegistry.registerEndpoints(...batchEndpoints);

export default async function requestHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    if (req.url === '/') {
      res.writeHead(200, {
        'content-type': 'application/json',
      });
      res.end(
        TypeSerializer.stringify(
          {
            is: 'Ulixee Sidechain',
            version: packageJson.version,
            activeBatches: MicronoteBatchManager.getOpenBatches().map(batch => batch.toJSON()),
            giftCardBatch: MicronoteBatchManager.giftCardBatch?.toJSON(),
            blockSettings: await BlockManager.settings,
          },
          { format: true },
        ),
      );
      return;
    }

    if (req.url === '/health') {
      await MainDb.healthCheck();
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('OK');
      return;
    }

    if (req.url.startsWith('/api') || ApiRegistry.hasHandlerForPath(req.url)) {
      return await ApiRegistry.route(req, res);
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not Found');

    log.warn(`${req.method}:${req.url} (404 MISSING)`);
  } catch (err) {
    log.warn(`ERROR running route ${req.method}:${req.url}`, { error: err } as any);
    res.writeHead(err.status ?? 500, {
      'content-type': 'application/json',
    });
    res.end(TypeSerializer.stringify(err));
  }
}
