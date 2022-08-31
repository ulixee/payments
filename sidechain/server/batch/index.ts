import MicronoteBatchManager from '../main/lib/MicronoteBatchManager';
import IBatchState from '../interfaces/IBatchState';
import { BridgeToMain, BridgeToBatch } from '../bridges';

export const ActiveBatches = {
  // if this is on it's own server, we'll eventually need to look up from config
  get(slug: string): IBatchState {
    return MicronoteBatchManager.get(slug);
  },
};

export { BridgeToMain as bridgeToMain, BridgeToBatch as bridgeToBatch };
