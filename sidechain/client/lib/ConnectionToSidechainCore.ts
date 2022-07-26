import { ConnectionToCore } from '@ulixee/net';
import { ISidechainApis } from '@ulixee/specification/sidechain';
import HttpTransportToCore from '@ulixee/net/lib/HttpTransportToCore';

export default class ConnectionToSidechainCore extends ConnectionToCore<
  ISidechainApis,
  {}
> {
  public static remote(serverHost: string): ConnectionToSidechainCore {
    const transport = new HttpTransportToCore(`${serverHost}/api`);
    return new ConnectionToSidechainCore(transport);
  }
}
