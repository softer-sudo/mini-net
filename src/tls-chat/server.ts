import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineFramer, MAX_LINE_BYTES } from '../common/line-framer.js';
import { getFlagOrDefault } from '../common/args.js';

const defaultCertDir = path.resolve(fileURLToPath(import.meta.url), '../../../certs');

// Deliberately near-identical to ../tcp-chat/server.ts — same protocol, TLS is
// just the encrypted transport. Keep them readable independently rather than
// abstracting the overlap away.

export function startTlsChatServer(port: number, certDir: string = defaultCertDir): tls.Server {
  const options: tls.TlsOptions = {
    key: fs.readFileSync(path.join(certDir, 'server.key')),
    cert: fs.readFileSync(path.join(certDir, 'server.cert')),
  };

  const clients = new Set<tls.TLSSocket>();

  const server = tls.createServer(options, (socket) => {
    clients.add(socket);
    const address = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[tls-chat] connected: ${address}`);

    socket.setTimeout(60_000);

    const framer = new LineFramer();
    framer.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const message = `[${address}] ${trimmed}\n`;
      for (const other of clients) {
        if (other !== socket) other.write(message);
      }
    });
    framer.on('overflow', () => {
      console.warn(`[tls-chat] ${address} exceeded ${MAX_LINE_BYTES}-byte line limit, disconnecting`);
      socket.write('ERROR: line too long, closing connection\n', () => socket.destroy());
    });

    socket.on('data', (chunk) => framer.feed(chunk));
    socket.on('timeout', () => {
      console.log(`[tls-chat] ${address} timed out (idle 60s)`);
      socket.end();
    });
    socket.on('close', () => {
      clients.delete(socket);
      console.log(`[tls-chat] disconnected: ${address}`);
    });
    socket.on('error', (err) => console.warn(`[tls-chat] socket error from ${address}: ${err.message}`));
  });

  server.on('error', (err) => {
    console.error(`[tls-chat] server error: ${err.message}`);
    process.exitCode = 1;
  });

  server.listen(port, () => {
    const addr = server.address();
    const boundPort = typeof addr === 'object' && addr ? addr.port : port;
    console.log(`[tls-chat] server listening on port ${boundPort}`);
  });

  return server;
}

export async function runServerCommand(args: string[]): Promise<void> {
  const port = Number(getFlagOrDefault(args, '--port', '4443'));
  startTlsChatServer(port);
}
