import KeyringSignature from '@ulixee/crypto/lib/KeyringSignature';
import { hashObject } from '@ulixee/commons/lib/hashUtils';
import SidechainApiSchema from '@ulixee/specification/sidechain';
import Keypair from '@ulixee/crypto/lib/Keypair';
import { IZodApiTypes } from '@ulixee/specification/utils/IZodApi';
import { IWalletSignature } from '@ulixee/specification';
import { z } from 'zod';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import { PermissionsError, ValidationError } from './errors';

export interface IHandlerOptions {
  logger: IBoundLog;
}

export default class ApiHandler<
  Command extends keyof typeof SidechainApiSchema & string,
  RequestType = z.infer<typeof SidechainApiSchema[Command]['args']>,
  ResultType = z.infer<typeof SidechainApiSchema[Command]['result']>,
> {
  public readonly apiHandler: (
    this: ApiHandler<Command>,
    args: RequestType,
    options?: IHandlerOptions,
  ) => Promise<ResultType>;

  private readonly spec: IZodApiTypes;

  constructor(
    public readonly command: Command,
    args: {
      handler: (
        this: ApiHandler<Command>,
        args: RequestType,
        options?: IHandlerOptions,
      ) => Promise<ResultType>;
    },
  ) {
    this.spec = SidechainApiSchema[command];
    this.apiHandler = args.handler.bind(this);
  }

  public async handler(rawArgs: unknown, options?: IHandlerOptions): Promise<ResultType> {
    const args = this.validatePayload(rawArgs);
    return await this.apiHandler(args, options);
  }

  public validatePayload(data: unknown): RequestType {
    // NOTE: mutates `errors`
    const result = this.spec.args.safeParse(data);
    if (result.success) return result.data;

    if (result.success === false) {
      const errorList = result.error.issues.map(x => `"${x.path.join('.')}": ${x.message}`);

      throw new ValidationError(this.command, errorList);
    }
  }

  public validateWalletSignature(
    address: string,
    payload: RequestType,
    signature: IWalletSignature,
    isClaim = true,
  ): void {
    const messageHash = hashObject(payload, {
      prefix: Buffer.from(this.command),
      ignoreProperties: ['signature'] as any,
    });
    const invalidSignatureReason = KeyringSignature.verify(
      address,
      signature,
      messageHash,
      isClaim,
    );
    if (invalidSignatureReason) {
      throw new PermissionsError(invalidSignatureReason);
    }
  }

  public validatedDigitalSignature(publicKey: Buffer, payload: any, signature: Buffer): void {
    const messageHash = hashObject(payload, {
      prefix: Buffer.concat([Buffer.from(this.command), publicKey]),
      ignoreProperties: ['signature'],
    });
    const isValid = Keypair.verify(publicKey, messageHash, signature);
    if (!isValid) {
      throw new PermissionsError('Invalid signature provided');
    }
  }
}
