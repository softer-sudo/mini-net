import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { startUdpMessengerServer, UDP_MAX_MESSAGE_BYTES } from '../src/udp-messenger/server.js';
import { connectUdpMessengerClient } from '../src/udp-messenger/client.js';

function boundPort(socket: dgram.Socket): number {
  return (socket.address() as dgram.AddressInfo).port;
}

test('relays a message to a previously-seen peer, not back to the sender', async () => {
  const server = startUdpMessengerServer(0);
  await once(server, 'listening');
  const port = boundPort(server);

  const a = dgram.createSocket('udp4');
  const b = dgram.createSocket('udp4');
  const aMessages: string[] = [];
  const bMessages: string[] = [];
  a.on('message', (msg) => aMessages.push(msg.toString()));
  b.on('message', (msg) => bMessages.push(msg.toString()));

  a.send('hello a', port, '127.0.0.1');
  await new Promise((resolve) => setTimeout(resolve, 50));

  b.send('hello b', port, '127.0.0.1');
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(aMessages.length, 1);
  assert.match(aMessages[0], /hello b/);
  assert.equal(bMessages.length, 0);

  a.close();
  b.close();
  server.close();
});

test('drops an oversized datagram instead of relaying it', async () => {
  const server = startUdpMessengerServer(0);
  await once(server, 'listening');
  const port = boundPort(server);

  const b = dgram.createSocket('udp4');
  const c = dgram.createSocket('udp4');
  const cMessages: string[] = [];
  c.on('message', (msg) => cMessages.push(msg.toString()));

  c.send('seed', port, '127.0.0.1');
  await new Promise((resolve) => setTimeout(resolve, 50));

  b.send(Buffer.alloc(UDP_MAX_MESSAGE_BYTES + 1, 'x'), port, '127.0.0.1');
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(cMessages.length, 0);

  b.close();
  c.close();
  server.close();
});

test('client fires a connect event and then a message event', async () => {
  const server = startUdpMessengerServer(0);
  await once(server, 'listening');
  const port = boundPort(server);

  const other = dgram.createSocket('udp4');
  other.send('seed', port, '127.0.0.1');
  await new Promise((resolve) => setTimeout(resolve, 50));

  const client = connectUdpMessengerClient('127.0.0.1', port);
  await once(client, 'connect');

  client.send('ping');
  const [msg] = await once(other, 'message');
  assert.match(msg.toString(), /ping/);

  client.close();
  other.close();
  server.close();
});

test('client closes itself after the idle timeout elapses', async () => {
  const server = startUdpMessengerServer(0);
  await once(server, 'listening');
  const port = boundPort(server);

  const client = connectUdpMessengerClient('127.0.0.1', port, 100);
  await once(client, 'connect');
  await once(client, 'close');

  server.close();
});
