import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { startTcpChatServer } from '../src/tcp-chat/server.js';
import { connectTcpChatClient } from '../src/tcp-chat/client.js';

test('broadcasts a message from one client to another, not back to the sender', async () => {
  const server = startTcpChatServer(0);
  await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;

  const a = net.createConnection({ port, host: '127.0.0.1' });
  const b = net.createConnection({ port, host: '127.0.0.1' });
  try {
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
  } finally {
    a.destroy();
    b.destroy();
    server.close();
  }
});

test('disconnects a client that sends an oversized line with no newline', async () => {
  const server = startTcpChatServer(0);
  await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;

  const client = net.createConnection({ port, host: '127.0.0.1' });
  await once(client, 'connect');

  const closed = once(client, 'close');
  client.resume();
  client.write(Buffer.alloc(2000, 'a'));
  await closed;

  server.close();
});

test('a well-behaved client stays connected after a normal-length message', async () => {
  const server = startTcpChatServer(0);
  await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;

  const client = net.createConnection({ port, host: '127.0.0.1' });
  try {
    await once(client, 'connect');

    client.write('short message\n');
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(client.destroyed, false);
  } finally {
    client.destroy();
    server.close();
  }
});

test('a maximum-length broadcast line does not deafen the receiving client', async () => {
  const server = startTcpChatServer(0);
  await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;

  const a = net.createConnection({ port, host: '127.0.0.1' });
  const b = connectTcpChatClient('127.0.0.1', port);
  try {
    await Promise.all([once(a, 'connect'), once(b, 'connect')]);

    const printedLines: string[] = [];
    const originalLog = console.log;
    console.log = ((msg: unknown) => { printedLines.push(String(msg)); }) as typeof console.log;
    try {
      a.write(`${'a'.repeat(1024)}\n`); // exactly MAX_LINE_BYTES, legal at the server's incoming framer
      await new Promise((resolve) => setTimeout(resolve, 150));
      a.write('short follow-up\n'); // proves b is still listening afterward, not silently deafened
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      console.log = originalLog;
    }

    assert.ok(printedLines.some((line) => line.includes('a'.repeat(1024))), 'the max-length broadcast should have reached b');
    assert.ok(printedLines.some((line) => line.includes('short follow-up')), 'b must still be listening after the max-length line');
  } finally {
    a.destroy();
    b.destroy();
    server.close();
  }
});
