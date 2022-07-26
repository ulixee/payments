import { AddressInfo } from 'net';
import * as http from 'http';
import app from '../app';

let server: http.Server;

export function start(): Promise<any> {
  if (server) {
    server.close();
  }
  server = http.createServer(app);
  const started = new Promise(resolve => server.once('listening', resolve));
  server.listen(0);
  return started;
}

export function serverPort(): number {
  return (server.address() as AddressInfo).port;
}

export async function close(): Promise<void> {
  if (!server) return;
  await new Promise(resolve => {
    server.close(() => setTimeout(resolve, 1));
    server = null;
  });
}
