import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer } from '@ulixee/commons/lib/bufferUtils';
import config from '../../config';
import ApiHandler from '../../utils/ApiHandler';
import BlockManager from '../lib/BlockManager';

const { version } = require('../../package.json');

export default new ApiHandler('Sidechain.settings', {
  async handler({ identity }) {
    const blockSettings = await BlockManager.settings;
    let identityProofSignature: Buffer;
    if (identity) {
      identityProofSignature = config.rootIdentity.sign(
        sha3(concatAsBuffer(this.command, identity)),
      );
    }
    return {
      // built to handle more than one key if we need to rotate one out
      rootIdentities: [config.rootIdentity.bech32],
      identityProofSignatures: [identityProofSignature],
      latestBlockSettings: blockSettings,
      batchDurationMinutes: config.micronoteBatch.openMinutes,
      settlementFeeMicrogons: config.micronoteBatch.settlementFeeMicrogons,
      version,
    };
  },
});
