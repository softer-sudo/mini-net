import net from 'node:net';
import { LineFramer, MAX_LINE_BYTES } from '../common/line-framer.js';
import { getFlagOrDefault } from '../common/args.js';

// Deliberately near-identical to ../tls-chat/server.ts — same protocol, TLS is
// just the encrypted transport. Keep them readable independently rather than
// abstracting the overlap away.

export function startTcpChatServer(port: number): net.Server {
  const clients = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    clients.add(socket);
    const address = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[tcp-chat] connected: ${address}`);

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
      console.warn(`[tcp-chat] ${address} exceeded ${MAX_LINE_BYTES}-byte line limit, disconnecting`);
      socket.write('ERROR: line too long, closing connection\n', () => socket.destroy());
    });

    socket.on('data', (chunk) => framer.feed(chunk));
    socket.on('timeout', () => {
      console.log(`[tcp-chat] ${address} timed out (idle 60s)`);
      socket.end();
    });
    socket.on('close', () => {
      clients.delete(socket);
      console.log(`[tcp-chat] disconnected: ${address}`);
    });
    socket.on('error', (err) => {
      console.warn(`[tcp-chat] socket error from ${address}: ${err.message}`);
    });
  });

  server.on('error', (err) => {
    console.error(`[tcp-chat] server error: ${err.message}`);
    process.exitCode = 1;
  });

  server.listen(port, () => {
    const addr = server.address();
    const boundPort = typeof addr === 'object' && addr ? addr.port : port;
    console.log(`[tcp-chat] server listening on port ${boundPort}`);
  });

  return server;
}

export async function runServerCommand(args: string[]): Promise<void> {
  const port = Number(getFlagOrDefault(args, '--port', '4000'));
  startTcpChatServer(port);
}
