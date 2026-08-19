import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineFramer } from '../common/line-framer.js';
import { getFlagOrDefault } from '../common/args.js';
import { relayStdinLines } from '../common/stdin-relay.js';

const defaultCertDir = path.resolve(fileURLToPath(import.meta.url), '../../../certs');

export function connectTlsChatClient(host: string, port: number, certDir: string = defaultCertDir): tls.TLSSocket {
  const ca = fs.readFileSync(path.join(certDir, 'server.cert'));
  // rejectUnauthorized stays at its default (true): we pin the CA instead of
  // disabling verification, so a mismatched or expired cert still fails closed.
  const socket = tls.connect({ host, port, ca });
  const framer = new LineFramer();

  socket.on('secureConnect', () => {
    console.log(`[tls-chat] TLS connected to ${host}:${port} (authorized: ${socket.authorized})`);
  });
  framer.on('line', (line: string) => console.log(line));
  socket.on('data', (chunk) => framer.feed(chunk));

  socket.setTimeout(60_000);
  socket.on('timeout', () => {
    console.log('[tls-chat] connection idle timeout, closing');
    socket.end();
  });
  socket.on('close', () => console.log('[tls-chat] connection closed'));
  socket.on('error', (err) => console.warn(`[tls-chat] connection error: ${err.message}`));

  return socket;
}

export async function runClientCommand(args: string[]): Promise<void> {
  const host = getFlagOrDefault(args, '--host', 'localhost');
  const port = Number(getFlagOrDefault(args, '--port', '4443'));
  const socket = connectTlsChatClient(host, port);
  const rl = relayStdinLines((line) => socket.write(`${line}\n`));
  socket.on('close', () => rl.close());
}
