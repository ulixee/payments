// eslint-disable-next-line max-classes-per-file
import { UlixeeError } from '@ulixee/commons/lib/errors';

export class InsufficientFundsError extends UlixeeError {
  constructor(message: string, balance: string) {
    super(message || 'This wallet does not have enough microgons to proceed', 'ERR_NSF', {
      balance,
    });
  }
}

export class InvalidParameterError extends UlixeeError {
  constructor(message, parameter?: string, data: object = {}) {
    super(message || 'Invalid parameter', 'ERR_INVALID_PARAM', { parameter, ...data });
  }
}

export class ConflictError extends UlixeeError {
  constructor(message: string) {
    super(
      message || 'This change would conflict with the existing state of the system',
      'ERR_CONFLICT',
    );
  }
}

export class NotFoundError extends UlixeeError {
  constructor(message: string, id?: string | number | Buffer) {
    super(message || 'Item not found', 'ERR_NOT_FOUND', { id: String(id) });
  }
}

export class DuplicateError extends UlixeeError {
  constructor(message: string, type: string) {
    super(
      'This change is not allowed because it would cause a duplicate error to occur',
      'ERR_DUPLICATE',
      { type },
    );
  }
}

export class MicronoteFundsNeededError extends UlixeeError {
  constructor(message: string, centagons: number) {
    super(message || 'Batch funding is needed', 'ERR_NEEDS_BATCH_FUNDING', {
      minCentagonsNeeded: centagons,
    });
  }
}

export class NewNotesNotBeingAcceptedError extends UlixeeError {
  constructor() {
    super('This micronoteBatch is closing. New notes are not being accepted', 'ERR_CLOSING');
  }
}

export class MicronoteBatchClosedError extends UlixeeError {
  constructor() {
    super('This micronoteBatch cannot accept any updates', 'ERR_CLOSED');
  }
}

export class OutOfBalanceError extends UlixeeError {
  constructor(addressesBalance: string, fundsBalance: string) {
    super('The sidechain balances are not adding to zero', 'ERR_OUT_OF_BALANCE', {
      addressesBalance,
      fundsBalance,
    });
  }
}

export class InvalidRecipientError extends UlixeeError {
  constructor(message: string) {
    super(message, 'ERR_INVALID_RECIPIENT');
  }
}

export class InvalidStakeTransactionRecipientError extends UlixeeError {
  constructor() {
    super(
      'The provided stake transaction was not sent to the root public key of this sidechain',
      'ERR_INVALID_TRANSACTION_RECIPIENT',
    );
  }
}

export class InvalidNoteHashError extends UlixeeError {
  constructor() {
    super('The provided note hash does not match the calculated hash', 'ERR_INVALID_HASH');
  }
}
