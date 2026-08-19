import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTlsChatServer } from '../src/tls-chat/server.js';
import { connectTlsChatClient } from '../src/tls-chat/client.js';

const root = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const certDir = path.join(root, 'certs');

function ensureCerts(): void {
  if (!existsSync(path.join(certDir, 'server.cert'))) {
    execFileSync('bash', [path.join(root, 'scripts/gen-cert.sh')], { stdio: 'inherit' });
  }
}

test('TLS client completes a verified handshake and receives a broadcast', async () => {
  ensureCerts();
  const server = startTlsChatServer(0, certDir);
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;

  const a = connectTlsChatClient('localhost', port, certDir);
  const b = connectTlsChatClient('localhost', port, certDir);
  try {
    await Promise.all([once(a, 'secureConnect'), once(b, 'secureConnect')]);

    assert.equal(a.authorized, true);
    assert.equal(b.authorized, true);

    // Small delay to ensure sockets are fully established
    await new Promise((resolve) => setTimeout(resolve, 50));

    const bMessages: string[] = [];
    b.on('data', (chunk) => bMessages.push(chunk.toString()));

    a.write('hello over tls\n');
    await once(b, 'data');

    assert.equal(bMessages.length, 1);
    assert.match(bMessages[0], /hello over tls/);
  } finally {
    a.destroy();
    b.destroy();
    server.close();
  }
});

test('TLS server disconnects a client sending an oversized unterminated line', async () => {
  ensureCerts();
  const server = startTlsChatServer(0, certDir);
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;

  const client = connectTlsChatClient('localhost', port, certDir);
  await once(client, 'secureConnect');

  const closed = once(client, 'close');
  client.resume(); // drain the "ERROR: line too long..." the server writes before destroying, or 'close' never fires
  client.write(Buffer.alloc(2000, 'a'));
  await closed;

  server.close();
});
