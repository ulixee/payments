import Logger from '@ulixee/commons/lib/Logger';
import { IncomingMessage, ServerResponse } from 'http';
import HttpTransportToClient from '@ulixee/net/lib/HttpTransportToClient';
import ApiHandler from './ApiHandler';

const { log } = Logger(module);

export default class ApiRegistry {
  private static commands: { [key: string]: (...args: any[]) => Promise<any> } = {};

  public static hasHandlerForPath(path: string): boolean {
    return !!this.commands[path.substring(1)];
  }

  public static registerEndpoints(...endpoints: ApiHandler<any>[]): void {
    for (const endpoint of endpoints) {
      this.commands[endpoint.command] = endpoint.handler.bind(endpoint);
    }
  }

  public static async route(req: IncomingMessage, res: ServerResponse): Promise<any> {
    const startTime = Date.now();

    const transport = new HttpTransportToClient(req, res);
    const apiRequest = await transport.readRequest();
    const { command, messageId } = apiRequest;

    const logger = log.createChild(module, {
      remote: transport.remoteId,
      messageId,
      command,
    });

    let data: any;
    try {
      logger.info(`api/${apiRequest.command}`, {
        path: req.url,
        apiRequest,
      });

      const handler = this.commands[command];
      if (!handler) throw new Error(`Unknown api requested: ${String(command)}`);

      let args = apiRequest.args;
      if (!Array.isArray(args)) args = [apiRequest.args];

      data = await handler(...args, { logger });
    } catch (error) {
      logger.error(`api/${apiRequest.command}:ERROR`, {
        error,
      });
      data = error;
    }

    await transport.send({
      responseId: messageId,
      data,
    });

    logger.stats(`api/${apiRequest.command}:END`, { data, millis: Date.now() - startTime });
  }
}
