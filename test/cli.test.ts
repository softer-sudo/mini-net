import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, registerCommand } from '../src/cli.js';

test('no command prints usage to stdout and exits 1', async () => {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => { chunks.push(String(chunk)); return true; }) as typeof process.stdout.write;
  const code = await run([]);
  process.stdout.write = original;
  assert.equal(code, 1);
  assert.match(chunks.join(''), /Usage:/);
});

test('--help prints usage to stdout and exits 0', async () => {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => { chunks.push(String(chunk)); return true; }) as typeof process.stdout.write;
  const code = await run(['--help']);
  process.stdout.write = original;
  assert.equal(code, 0);
  assert.match(chunks.join(''), /Usage:/);
});

test('unknown command prints an error to stderr and exits 1', async () => {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => { chunks.push(String(chunk)); return true; }) as typeof process.stderr.write;
  const code = await run(['bogus']);
  process.stderr.write = original;
  assert.equal(code, 1);
  assert.match(chunks.join(''), /Unknown command: bogus/);
});

test('registered command handler is invoked with the remaining args', async () => {
  let received: string[] | null = null;
  registerCommand('__test-echo', (args) => { received = args; });
  const code = await run(['__test-echo', 'a', 'b']);
  assert.equal(code, 0);
  assert.deepEqual(received, ['a', 'b']);
});
