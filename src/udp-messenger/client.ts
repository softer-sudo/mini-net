import dgram from 'node:dgram';
import { getFlagOrDefault } from '../common/args.js';
import { relayStdinLines } from '../common/stdin-relay.js';

export const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

export function connectUdpMessengerClient(
  host: string,
  port: number,
  idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
): dgram.Socket {
  const socket = dgram.createSocket('udp4');
  let idleTimer: NodeJS.Timeout;

  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      console.log(`[udp-messenger] idle for ${idleTimeoutMs / 1000}s, closing`);
      socket.close();
    }, idleTimeoutMs);
  };

  socket.connect(port, host, () => {
    console.log(`[udp-messenger] connected to ${host}:${port}`);
    resetIdleTimer();
  });

  socket.on('message', (msg) => {
    console.log(msg.toString('utf8'));
    resetIdleTimer();
  });

  socket.on('error', (err) => console.warn(`[udp-messenger] error: ${err.message}`));
  socket.on('close', () => {
    clearTimeout(idleTimer);
    console.log('[udp-messenger] connection closed');
  });

  return socket;
}

export async function runClientCommand(args: string[]): Promise<void> {
  const host = getFlagOrDefault(args, '--host', 'localhost');
  const port = Number(getFlagOrDefault(args, '--port', '5000'));
  const socket = connectUdpMessengerClient(host, port);
  const rl = relayStdinLines((line) => socket.send(line));
  socket.on('close', () => rl.close());
}
