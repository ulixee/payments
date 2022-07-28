import Log from '@ulixee/commons/lib/Logger';
import * as Koa from 'koa';
import TypeSerializer from '@ulixee/commons/lib/TypeSerializer';
import ApiRouter from './utils/ApiRouter';
import MainDb from './main/db';
import batchEndpoints from './batch/endpoints';
import mainEndpoints from './main/endpoints';
import MicronoteBatchManager from './main/lib/MicronoteBatchManager';
import BlockManager from './main/lib/BlockManager';

const packageJson = require('./package.json');

const { log } = Log(module);

const koa = new Koa();

ApiRouter.registerEndpoints(...mainEndpoints);
ApiRouter.registerEndpoints(...batchEndpoints);

/// /////////////////////////////////////////////////////////////////////////////////////////////////

koa.use(async ctx => {
  try {
    if (ctx.path === '/') {
      ctx.status = 200;
      ctx.body = TypeSerializer.stringify(
        {
          is: 'Ulixee Sidechain',
          version: packageJson.version,
          activeBatches: MicronoteBatchManager.getOpenBatches().map(batch => ({
            opened: batch.data.openTime,
            closing: batch.data.plannedClosingTime,
            closed: batch.data.closedTime,
            slug: batch.slug,
            address: batch.address,
          })),
          blockSettings: await BlockManager.settings,
        },
        { format: true },
      );
      return;
    }
    if (ctx.path === '/health') {
      return await healthCheck(ctx);
    }
    if (ctx.path.startsWith('/api') || ApiRouter.hasHandlerForPath(ctx.path)) {
      return await ApiRouter.route(ctx);
    }
    ctx.status = 404;
    ctx.body = 'Not Found';
    log.warn(`${ctx.method}:${ctx.path} (404 MISSING)`);
  } catch (err) {
    handleError(ctx, err);
  }
});

/// //   HELPERS           /////////////////////////////////////////////////////////////////////////

async function healthCheck(ctx): Promise<void> {
  await MainDb.healthCheck();
  ctx.body = 'OK';
  ctx.status = 200;
}

function handleError(ctx, err): void {
  log.error(`ERROR running route ${ctx.path}`, { error: err, sessionId: null });
  ctx.status = err.status || 500;
  if (err.toJSON) {
    ctx.body = err.toJSON();
  } else {
    ctx.body = {
      code: err.code || err.id || 'UNKNOWN',
      message: err.message,
    };
  }
}

export default koa.callback();
