import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import ValidatingApiHandler from '@ulixee/specification/utils/ValidatingApiHandler';
import MainchainApiSchema, { IMainchainApiTypes } from '@ulixee/specification/mainchain';
import BlockLookup from './BlockLookup';

export interface IHandlerOptions {
  logger: IBoundLog;
  blockLookup: BlockLookup;
}

export default class MainchainApiHandler<
  Command extends keyof IMainchainApiTypes & string,
> extends ValidatingApiHandler<typeof MainchainApiSchema, Command, IMainchainApiTypes, IHandlerOptions> {
  constructor(
    command: Command,
    args: {
      handler: (
        this: MainchainApiHandler<Command>,
        args: IMainchainApiTypes[Command]['args'],
        options?: IHandlerOptions,
      ) => Promise<IMainchainApiTypes[Command]['result']>;
    },
  ) {
    super(command, MainchainApiSchema, args);
    this.apiHandler = args.handler.bind(this);
  }
}
