import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(import.meta.url), '../..');
const certPath = path.join(root, 'certs/server.cert');
const keyPath = path.join(root, 'certs/server.key');

test('gen-cert.sh produces a self-signed cert with SAN for localhost and 127.0.0.1', () => {
  if (!existsSync(certPath) || !existsSync(keyPath)) {
    execFileSync('bash', [path.join(root, 'scripts/gen-cert.sh')], { stdio: 'inherit' });
  }
  assert.ok(existsSync(certPath));
  assert.ok(existsSync(keyPath));

  const cert = new X509Certificate(readFileSync(certPath));
  assert.match(cert.subjectAltName ?? '', /DNS:localhost/);
  assert.match(cert.subjectAltName ?? '', /IP Address:127\.0\.0\.1/);
});
