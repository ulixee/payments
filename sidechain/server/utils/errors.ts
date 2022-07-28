// eslint-disable-next-line max-classes-per-file
export class AppError extends Error {
  public code: string;
  constructor(message: string, code: string, public readonly data?: object) {
    // Calling parent constructor of base Error class.
    super(message);

    this.code = code;

    // Capturing stack trace, excluding constructor call from it.
    Error.captureStackTrace(this, this.constructor);
  }

  public toJSON(): any {
    return {
      message: this.message,
      ...this,
    };
  }
}

export class PermissionsError extends AppError {
  constructor(message) {
    super(message || 'Insufficient permissions', 'ERR_PERMISSIONS');
  }
}

export class InvalidParameterError extends AppError {
  constructor(message, parameter?: string, data?: object) {
    super(message || 'Invalid parameter', 'ERR_INVALID_PARAM', { parameter, data });
  }
}

export class ValidationError extends AppError {
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

export class InsufficientFundsError extends AppError {
  constructor(message: string, balance: string) {
    super(message || 'This wallet does not have enough microgons to proceed', 'ERR_NSF', {
      balance,
    });
  }
}

export class MicronoteFundsNeededError extends AppError {
  constructor(message: string, centagons: number) {
    super(message || 'Batch funding is needed', 'ERR_NEEDS_BATCH_FUNDING', {
      minCentagonsNeeded: centagons,
    });
  }
}

export class WalletAlreadyRegisteredError extends AppError {
  constructor() {
    super('This wallet has already been registered', 'ERR_ALREADY_REGISTERED');
  }
}

export class NewNotesNotBeingAcceptedError extends AppError {
  constructor() {
    super('This micronoteBatch is closing.  New notes are not being accepted', 'ERR_CLOSING');
  }
}

export class MicronoteBatchClosedError extends AppError {
  constructor() {
    super('This micronoteBatch cannot accept any updates', 'ERR_CLOSED');
  }
}

export class OutOfBalanceError extends AppError {
  constructor(walletsBalance: string, fundsBalance: string) {
    super('The sidechain balances are not adding to zero', 'ERR_OUT_OF_BALANCE', {
      walletsBalance,
      fundsBalance,
    });
  }
}

export class InvalidRecipientError extends AppError {
  constructor(message: string) {
    super(message, 'ERR_INVALID_RECIPIENT');
  }
}

export class InvalidStakeTransactionRecipientError extends AppError {
  constructor() {
    super(
      'The provided stake transaction was not sent to the root public key of this sidechain',
      'ERR_INVALID_TRANSACTION_RECIPIENT',
    );
  }
}

export class InvalidNoteHashError extends AppError {
  constructor() {
    super('The provided note hash does not match the calculated hash', 'ERR_INVALID_HASH');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(
      message || 'This change would conflict with the existing state of the system',
      'ERR_CONFLICT',
    );
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, id?: string | number | Buffer) {
    super(message || 'Item not found', 'ERR_NOT_FOUND', { id: String(id) });
  }
}

export class DuplicateError extends AppError {
  constructor(message: string, type: string) {
    super(
      'This change is not allowed because it would cause a duplicate error to occur',
      'ERR_DUPLICATE',
      { type },
    );
  }
}
