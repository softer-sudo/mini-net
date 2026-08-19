import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { startTcpChatServer } from '../src/tcp-chat/server.js';

test('broadcasts a message from one client to another, not back to the sender', async () => {
  const server = startTcpChatServer(0);
  await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;

  const a = net.createConnection({ port, host: '127.0.0.1' });
  const b = net.createConnection({ port, host: '127.0.0.1' });
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);

  const aMessages: string[] = [];
  const bMessages: string[] = [];
  a.on('data', (chunk) => aMessages.push(chunk.toString()));
  b.on('data', (chunk) => bMessages.push(chunk.toString()));

  a.write('hello from a\n');
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(bMessages.length, 1);
  assert.match(bMessages[0], /hello from a/);
  assert.equal(aMessages.length, 0);

  a.destroy();
  b.destroy();
  server.close();
});

test('disconnects a client that sends an oversized line with no newline', async () => {
  const server = startTcpChatServer(0);
  await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;

  const client = net.createConnection({ port, host: '127.0.0.1' });
  await once(client, 'connect');

  const closed = once(client, 'close');
  client.write(Buffer.alloc(2000, 'a'));
  await closed;

  server.close();
});

test('a well-behaved client stays connected after a normal-length message', async () => {
  const server = startTcpChatServer(0);
  await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;

  const client = net.createConnection({ port, host: '127.0.0.1' });
  await once(client, 'connect');

  client.write('short message\n');
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(client.destroyed, false);

  client.destroy();
  server.close();
});
