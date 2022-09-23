import { AddressInfo } from 'net';
import GracefulServer from '@ulixee/payment-utils/api/GracefulServer';
import app from '../app';

let server: GracefulServer;
let port: number;

export function serverPort(): number {
  return port;
}

export async function start(): Promise<AddressInfo> {
  if (server) {
    await server.close();
  }
  server = app;
  const address = await server.start(0);
  port = address.port;
  return address;
}

export function close(): Promise<void> {
  return server?.close();
}
