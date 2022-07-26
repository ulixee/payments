import AddressSignature from '@ulixee/crypto/lib/AddressSignature';
import { hashObject } from '@ulixee/commons/lib/hashUtils';
import SidechainApiSchema, { ISidechainApiTypes } from '@ulixee/specification/sidechain';
import Identity from '@ulixee/crypto/lib/Identity';
import { IZodApiTypes } from '@ulixee/specification/utils/IZodApi';
import { IAddressSignature } from '@ulixee/specification';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import { concatAsBuffer } from '@ulixee/commons/lib/bufferUtils';
import { PermissionsError, ValidationError } from './errors';

export interface IHandlerOptions {
  logger: IBoundLog;
}

export default class ApiHandler<Command extends keyof ISidechainApiTypes & string> {
  public readonly apiHandler: (
    this: ApiHandler<Command>,
    args: ISidechainApiTypes[Command]['args'],
    options?: IHandlerOptions,
  ) => Promise<ISidechainApiTypes[Command]['result']>;

  private readonly spec: IZodApiTypes;

  constructor(
    public readonly command: Command,
    args: {
      handler: (
        this: ApiHandler<Command>,
        args: ISidechainApiTypes[Command]['args'],
        options?: IHandlerOptions,
      ) => Promise<ISidechainApiTypes[Command]['result']>;
    },
  ) {
    this.spec = SidechainApiSchema[command];
    this.apiHandler = args.handler.bind(this);
  }

  public async handler(
    rawArgs: unknown,
    options?: IHandlerOptions,
  ): Promise<ISidechainApiTypes[Command]['result']> {
    const args = this.validatePayload(rawArgs);
    return await this.apiHandler(args, options);
  }

  public validatePayload(data: unknown): ISidechainApiTypes[Command]['args'] {
    // NOTE: mutates `errors`
    const result = this.spec.args.safeParse(data);
    if (result.success) return result.data;

    if (result.success === false) {
      const errorList = result.error.issues.map(x => `"${x.path.join('.')}": ${x.message}`);

      throw new ValidationError(this.command, errorList);
    }
  }

  public validateAddressSignature(
    address: string,
    payload: ISidechainApiTypes[Command]['args'],
    signature: IAddressSignature,
    isClaim = true,
  ): void {
    const messageHash = hashObject(payload, {
      prefix: Buffer.from(this.command),
      ignoreProperties: ['signature'] as any,
    });
    const invalidSignatureReason = AddressSignature.verify(
      address,
      signature,
      messageHash,
      isClaim,
    );
    if (invalidSignatureReason) {
      throw new PermissionsError(invalidSignatureReason);
    }
  }

  public validatedDigitalSignature(identity: string, payload: any, signature: Buffer): void {
    const messageHash = hashObject(payload, {
      prefix: concatAsBuffer(this.command, identity),
      ignoreProperties: ['signature'],
    });
    const isValid = Identity.verify(identity, messageHash, signature);
    if (!isValid) {
      throw new PermissionsError('Invalid signature provided');
    }
  }
}
