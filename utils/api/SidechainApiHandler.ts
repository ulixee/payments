import SidechainApiSchema, { ISidechainApiTypes } from '@ulixee/specification/sidechain';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import ValidatingApiHandler from '@ulixee/specification/utils/ValidatingApiHandler';
import { IAddressSignature } from '@ulixee/specification';
import verifyIdentitySignature from '@ulixee/sidechain/lib/verifyIdentitySignature';
import verifyAddressSignature from '@ulixee/sidechain/lib/verifyAddressSignature';

export interface IHandlerOptions {
  logger: IBoundLog;
}

export default class SidechainApiHandler<
  Command extends keyof ISidechainApiTypes & string,
> extends ValidatingApiHandler<
  typeof SidechainApiSchema,
  Command,
  ISidechainApiTypes,
  IHandlerOptions
> {
  constructor(
    command: Command,
    args: {
      handler: (
        this: SidechainApiHandler<Command>,
        args: ISidechainApiTypes[Command]['args'],
        options?: IHandlerOptions,
      ) => Promise<ISidechainApiTypes[Command]['result']>;
    },
  ) {
    super(command, SidechainApiSchema, args);
    this.apiHandler = args.handler.bind(this);
  }

  public validateAddressSignature(
    address: string,
    payload: ISidechainApiTypes[Command]['args'],
    signature: IAddressSignature,
    isClaim = true,
  ): void {
    verifyAddressSignature(address, payload, this.command, signature, isClaim);
  }

  public validateIdentitySignature(identity: string, payload: any, signature: Buffer): void {
    verifyIdentitySignature(identity, payload, this.command, signature);
  }
}
