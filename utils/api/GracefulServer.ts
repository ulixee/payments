import * as http from 'http';
import { IncomingMessage, ServerResponse } from 'http';
import { AddressInfo, Socket } from 'net';
import Log from '@ulixee/commons/lib/Logger';
import { IBoundLog } from '@ulixee/commons/interfaces/ILog';
import Resolvable from '@ulixee/commons/lib/Resolvable';
import IApiHandler from '@ulixee/net/interfaces/IApiHandler';
import TypeSerializer from '@ulixee/commons/lib/TypeSerializer';
import ApiRegistry from '@ulixee/net/lib/ApiRegistry';
import ShutdownHandler from '@ulixee/commons/lib/ShutdownHandler';

const { log } = Log(module);

export default class GracefulServer {
  public server: http.Server;
  public apiRegistry: ApiRegistry;
  public readonly staticRoutes: {
    [path: string]: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
  } = {};

  public get address(): Promise<AddressInfo> {
    return this.startPromise.promise;
  }

  public isTerminated = false;

  private startPromise = new Resolvable<AddressInfo>();
  private readonly logger: IBoundLog;
  private sockets = new Set<Socket>();
  private pendingResponses = new Set<ServerResponse>();

  constructor(
    public name: string,
    public version: string,
    private endpoints: IApiHandler[],
    public options: {
      healthCheck?: () => Promise<any>;
      onSignal?: () => Promise<any>;
      rootMetadata?: () => Promise<object>;
      shutdownTimeout?: number;
    },
  ) {
    this.options.shutdownTimeout ??= 10e3;
    this.logger = log.createChild(module);
    this.apiRegistry = new ApiRegistry(endpoints);
    this.handle = this.handle.bind(this);
    this.server = new http.Server();
    this.server.on('error', this.onHttpError.bind(this));
    this.server.on('request', this.handle);
    this.server.on('connection', this.handleHttpConnection.bind(this));

    if (options.healthCheck) {
      this.staticRoutes['/healthcheck'] = async (req, res) => {
        try {
          await options.healthCheck();
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('ok');
        } catch (error) {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify(
              {
                status: 'error',
                error,
                details: error,
              },
              errorStackReplacer,
            ),
          );
        }
      };
    }
    this.staticRoutes['/'] = async (req, res) => {
      const extras = (await options.rootMetadata?.()) ?? {};
      res.writeHead(200, {
        'content-type': 'application/json',
      });
      res.end(
        TypeSerializer.stringify(
          {
            name,
            version,
            ...extras,
          },
          { format: true },
        ),
      );
    };
  }

  public async close(): Promise<void> {
    if (this.isTerminated) return;
    await this.options.onSignal?.();

    this.isTerminated = true;

    const endWaitAt = Date.now() + this.options.shutdownTimeout;
    while (this.pendingResponses.size && Date.now() < endWaitAt) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    for (const socket of this.sockets) {
      socket.unref().destroy();
    }
    await Promise.race([
      new Promise(resolve => this.server.close(resolve)),
      new Promise(resolve =>
        setTimeout(resolve, Math.max(0, endWaitAt - Date.now())).unref(),
      ),
    ]);
  }

  public async start(port: string | number): Promise<AddressInfo> {
    if (this.startPromise.isResolved) return this.startPromise.promise;

    try {
      this.logger.info('STARTING SERVER %s', this.name);

      ShutdownHandler.register(this.close.bind(this));

      await new Promise<void>(resolve => this.server.listen(port, resolve));
      const address = this.server.address() as AddressInfo;

      this.startPromise.resolve(address);

      const listenPort = address.port;

      this.logger.info(`${this.name} started`, { listenPort });
    } catch (error) {
      this.logger.error(`ERROR starting ${this.name}`, { error });
      this.startPromise.reject(error);
    }
    return this.address;
  }

  protected async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (this.isTerminated) {
        res.statusCode = 503;
        res.end('Shutting down');
        return;
      }
      this.pendingResponses.add(res);
      if (this.staticRoutes[req.url]) {
        await this.staticRoutes[req.url](req, res);
        return;
      }

      if (this.isTerminated) throw new Error('Server shutting down');

      if (req.url.startsWith('/api')) {
        if (await this.apiRegistry.handleHttpRoute(req, res)) return;
      }

      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');

      log.warn(`${req.method}:${req.url} (404 MISSING)`);
    } catch (err) {
      log.warn(`ERROR running route ${req.method}:${req.url}`, { error: err } as any);
      res.writeHead(err.status ?? 500, {
        'content-type': 'application/json',
      });
      res.end(TypeSerializer.stringify(err));
    } finally {
      this.pendingResponses.delete(res);
    }
  }

  private handleHttpConnection(socket: Socket): void {
    if (this.isTerminated) {
      socket.destroy();
      return;
    }
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
  }

  private onHttpError(error: Error): void {
    this.logger.warn('HttpServerError', {
      error,
      sessionId: null,
    });
  }
}

function errorStackReplacer(_, value: any): any {
  if (value instanceof Error) {
    const returnError: any = {};

    for (const key of Object.getOwnPropertyNames(value)) {
      if (process.env.NODE_ENV !== 'development' && key === 'stack') continue;

      returnError[key] = value[key];
    }

    return returnError;
  }

  return value;
}
