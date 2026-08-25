import net from 'node:net';
import { LineFramer, MAX_LINE_BYTES } from '../common/line-framer.js';
import { getFlagOrDefault } from '../common/args.js';
import { relayStdinLines } from '../common/stdin-relay.js';

const CLIENT_LINE_HEADROOM_BYTES = 128;

export function connectTcpChatClient(host: string, port: number): net.Socket {
  const socket = net.createConnection({ host, port });
  const framer = new LineFramer(MAX_LINE_BYTES + CLIENT_LINE_HEADROOM_BYTES);

  socket.on('connect', () => console.log(`[tcp-chat] connected to ${host}:${port}`));
  framer.on('line', (line: string) => console.log(line));
  framer.on('overflow', () => {
    console.warn('[tcp-chat] received an oversized line from the server, disconnecting');
    socket.destroy();
  });
  socket.on('data', (chunk) => framer.feed(chunk));

  socket.setTimeout(60_000);
  socket.on('timeout', () => {
    console.log('[tcp-chat] connection idle timeout, closing');
    socket.end();
  });
  socket.on('close', () => console.log('[tcp-chat] connection closed'));
  socket.on('error', (err) => console.warn(`[tcp-chat] connection error: ${err.message}`));

  return socket;
}

export async function runClientCommand(args: string[]): Promise<void> {
  const host = getFlagOrDefault(args, '--host', 'localhost');
  const port = Number(getFlagOrDefault(args, '--port', '4000'));
  const socket = connectTcpChatClient(host, port);
  const rl = relayStdinLines((line) => socket.write(`${line}\n`));
  socket.on('close', () => rl.close());
}
