import { TransactionError } from '@ulixee/specification';

export default class CodedError extends Error {
  constructor(message: string, readonly code: TransactionError) {
    super(message);
  }

  get data(): string {
    const extras = Object.entries(this).filter(([key]) => !['message', 'code'].includes(key));
    const details = {};
    for (const [key, value] of extras) {
      details[key] = value;
    }
    return JSON.stringify(details, null, 2);
  }

  public override toString(): string {
    return `${TransactionError[this.code]}: ${this.message}`;
  }
}
