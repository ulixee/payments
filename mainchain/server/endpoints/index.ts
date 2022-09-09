import GracefulServer from '@ulixee/payment-utils/api/GracefulServer';
import BlockGetMany from './Block.getMany';
import BlockSettings from './Block.settings';
import BlockHeaderGet from './BlockHeader.get';
import BlockLookup from '../lib/BlockLookup';
import { IHandlerOptions } from '../lib/MainchainApiHandler';

const packageJson = require('../package.json');

export function createServer(blockLookup: BlockLookup): GracefulServer {
  const server = new GracefulServer(
    'Ulixee Mainchain',
    packageJson.version,
    [BlockGetMany, BlockSettings, BlockHeaderGet],
    {
      onSignal: () => blockLookup.close(),
    },
  );
  server.apiRegistry.apiHandlerMetadataFn = (api, logger) => {
    return { blockLookup, logger } as IHandlerOptions;
  };
  return server;
}
