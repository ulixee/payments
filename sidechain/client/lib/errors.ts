// eslint-disable-next-line max-classes-per-file
import { UlixeeError } from '@ulixee/commons/lib/errors';

export class NeedsSidechainBatchFunding extends UlixeeError {
  constructor(message: string, readonly minCentagonsNeeded: number) {
    super(message, 'ERR_NEEDS_SIDECHAIN_FUNDING', { minCentagonsNeeded });
  }
}

export class ClientValidationError extends UlixeeError {
  constructor(command: string, errors: string[]) {
    super(
      `Please correct the API (${command}) parameters provided -> ${errors.join('; ')}`,
      'ERR_VALIDATION',
      {
        command,
        errors,
      },
    );
  }
}

export class InvalidPaymentBlockHeightError extends UlixeeError {
  constructor(currentBlockHeight: number, proposedBlockHeight: number) {
    super(
      'The proposed payment block height is not within an acceptable distance to the current block height',
      'ERR_INVALID_BLOCKHEIGHT',
      {
        currentBlockHeight,
        proposedBlockHeight,
      },
    );
  }
}
