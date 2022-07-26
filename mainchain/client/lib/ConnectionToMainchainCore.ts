import { ConnectionToCore } from '@ulixee/net';
import { IMainchainApis } from '@ulixee/specification/mainchain';
import HttpTransportToCore from '@ulixee/net/lib/HttpTransportToCore';

export default class ConnectionToMainchainCore extends ConnectionToCore<
  IMainchainApis,
  {}
> {
  public static remote(serverHost: string): ConnectionToMainchainCore {
    const transport = new HttpTransportToCore(`${serverHost}/api`);
    return new ConnectionToMainchainCore(transport);
  }
}
