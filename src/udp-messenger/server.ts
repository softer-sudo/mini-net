import dgram from 'node:dgram';
import { getFlagOrDefault } from '../common/args.js';

export const UDP_MAX_MESSAGE_BYTES = 2000;

export function startUdpMessengerServer(port: number): dgram.Socket {
  const socket = dgram.createSocket('udp4');
  const peers = new Map<string, { address: string; port: number }>();

  socket.on('message', (msg, rinfo) => {
    if (msg.length > UDP_MAX_MESSAGE_BYTES) {
      console.warn(`[udp-messenger] dropped oversized datagram (${msg.length} bytes) from ${rinfo.address}:${rinfo.port}`);
      return;
    }

    const key = `${rinfo.address}:${rinfo.port}`;
    peers.set(key, { address: rinfo.address, port: rinfo.port });
    console.log(`[udp-messenger] ${key} > ${msg.toString('utf8')}`);

    const text = `[${key}] ${msg.toString('utf8')}`;
    for (const [otherKey, peer] of peers) {
      if (otherKey !== key) socket.send(text, peer.port, peer.address);
    }
  });

  socket.on('error', (err) => {
    console.warn(`[udp-messenger] socket error: ${err.message}`);
    process.exitCode = 1;
  });
  socket.on('close', () => console.log('[udp-messenger] server socket closed'));

  socket.bind(port, () => {
    const addr = socket.address();
    console.log(`[udp-messenger] server listening on port ${addr.port}`);
  });

  return socket;
}

export async function runServerCommand(args: string[]): Promise<void> {
  const port = Number(getFlagOrDefault(args, '--port', '5000'));
  startUdpMessengerServer(port);
}
