import Log from '@ulixee/commons/lib/Logger';
import * as Koa from 'koa';
import TypeSerializer from '@ulixee/commons/lib/TypeSerializer';
import WalletGetBalance from './endpoints/Wallet.getBalance';
import WalletRegister from './endpoints/Wallet.register';
import FundingTransferKeys from './endpoints/FundingTransfer.keys';
import FundingTransferOut from './endpoints/FundingTransfer.out';
import FundingTransferStatus from './endpoints/FundingTransfer.status';
import MicronoteClaim from './endpoints/Micronote.claim';
import MicronoteCreate from './endpoints/Micronote.create';
import MicronoteLock from './endpoints/Micronote.lock';
import MicronoteBatchFund from './endpoints/MicronoteBatch.fund';
import MicronoteBatchFindFund from './endpoints/MicronoteBatch.findFund';
import MicronoteBatchGet from './endpoints/MicronoteBatch.get';
import MicronoteBatchGetFundSettlement from './endpoints/MicronoteBatch.getFundSettlement';
import MicroTransactionCreate from './endpoints/Note.create';
import MicroTransactionGet from './endpoints/Note.get';
import StakeCreate from './endpoints/Stake.create';
import StakeRefund from './endpoints/Stake.refund';
import StakeSettings from './endpoints/Stake.settings';
import StakeSignature from './endpoints/Stake.signature';
import ApiRouter from './lib/ApiRouter';
import db from './lib/defaultDb';
import MicronoteBatchManager from './lib/MicronoteBatchManager';
import BlockManager from './lib/BlockManager';

const packageJson = require('./package.json');

const { log } = Log(module);

const koa = new Koa();

ApiRouter.registerEndpoints(
  WalletGetBalance,
  WalletRegister,
  MicroTransactionCreate,
  MicroTransactionGet,
  StakeCreate,
  StakeRefund,
  StakeSettings,
  StakeSignature,
  FundingTransferOut,
  FundingTransferKeys,
  FundingTransferStatus,
  MicronoteBatchFund,
  MicronoteBatchFindFund,
  MicronoteBatchGet,
  MicronoteBatchGetFundSettlement,
  MicronoteClaim,
  MicronoteLock,
  MicronoteCreate,
  // SidechainSnapshotGet,
);

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
  await db.healthCheck();
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
