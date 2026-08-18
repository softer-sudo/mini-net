# mini-net Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `mini-net` CLI — nine self-contained networking demos (TCP chat, UDP messenger, TLS chat, DNS resolver, latency/traceroute) wired behind one dispatcher, each with automated tests and a README explaining the underlying concepts.

**Architecture:** A single npm package with a `src/cli.ts` command dispatcher and one directory per feature (`tcp-chat/`, `udp-messenger/`, `tls-chat/`, `dns/`, `latency/`), plus `src/common/` for the three pieces shared across features (`line-framer.ts` — the anti-DoS guard, `args.ts` — flag parsing, `stdin-relay.ts` — stdin-to-socket wiring). Every feature module exposes a plain, socket-level function (e.g. `startTcpChatServer(port)`) that is unit/integration-tested directly with real local sockets, decoupled from the CLI/stdin plumbing, plus a thin `run*Command(args)` wrapper that the CLI registers.

**Tech Stack:** Node.js ≥18, TypeScript 5, ESM (`NodeNext`), `node:test` + `node:assert/strict` for all tests (built-in, no third-party test framework), `tsx` as the only dev dependency (TS-transpile-on-the-fly for `npm run dev` and `npm test`), system `openssl` for cert generation, system `traceroute`/`tracert` for hop counting.

**Spec:** `docs/superpowers/specs/2026-08-18-mini-net-design.md`

## Global Constraints

- Node.js `>=18` (`engines.node` in package.json).
- ESM only: `"type": "module"`, `tsconfig.json` `module`/`moduleResolution: NodeNext`, `target: ES2022`.
- Every relative import between `src/` files MUST use an explicit `.js` extension (referencing the `.ts` file) — NodeNext requires this or the compiled `dist/` output breaks at runtime. e.g. `import { LineFramer } from '../common/line-framer.js'`.
- No CLI framework (commander/yargs) — `process.argv` parsed by hand via `src/common/args.ts`.
- No third-party test framework (no vitest/jest) — use Node's built-in `node:test` + `node:assert/strict`, run through `tsx --test`.
- TLS cert generation is a setup script (`scripts/gen-cert.sh`) shelling out to system `openssl`, never a runtime dependency.
- Hop measurement = our own TCP-connect RTT ping + system `traceroute`/`tracert` via `child_process` (no raw ICMP sockets — Node doesn't expose them without root/native addons).
- Chat topology is multi-client broadcast (not 1:1) for both `tcp-chat` and `tls-chat`.
- The featured, mitigated vulnerability is **unbounded input → memory-exhaustion DoS** via an unterminated/oversized line; the mitigation is `src/common/line-framer.ts`'s `MAX_LINE_BYTES` guard (1024 bytes), documented in README with its scope limits (not a general flood/SYN defense).
- Package manager: npm.

---

### Task 1: Project scaffolding, CLI dispatcher, shared utilities

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/cli.ts`
- Create: `src/common/args.ts`
- Create: `src/common/stdin-relay.ts`
- Test: `test/cli.test.ts`
- Test: `test/common/args.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `registerCommand(name: string, handler: (args: string[]) => Promise<void> | void): void` — `src/cli.ts`, used by every later task to hook in a sub-command.
  - `run(argv: string[]): Promise<number>` — `src/cli.ts`, the testable entry point.
  - `getFlag(args: string[], name: string): string | undefined` and `getFlagOrDefault(args: string[], name: string, fallback: string): string` — `src/common/args.ts`, used by every feature's `run*Command`.
  - `relayStdinLines(onLine: (line: string) => void): readline.Interface` — `src/common/stdin-relay.ts`, used by every client's `runClientCommand`.

- [ ] **Step 1: Create package.json, tsconfig.json, .gitignore**

`package.json`:
```json
{
  "name": "mini-net",
  "version": "0.1.0",
  "description": "Tiny Node.js + TypeScript CLI demonstrating networking fundamentals from raw sockets",
  "type": "module",
  "private": true,
  "engines": { "node": ">=18" },
  "bin": { "mini-net": "dist/cli.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/cli.ts",
    "gen-cert": "bash scripts/gen-cert.sh",
    "test": "tsx --test test"
  },
  "devDependencies": {
    "@types/node": "^20.14.2",
    "tsx": "^4.16.2",
    "typescript": "^5.5.4"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src"]
}
```

`.gitignore`:
```
node_modules/
dist/
certs/
*.log
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` written, no errors.

- [ ] **Step 3: Write failing tests for args.ts and cli.ts**

`test/common/args.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFlag, getFlagOrDefault } from '../../src/common/args.js';

test('getFlag returns the value following the flag', () => {
  assert.equal(getFlag(['--port', '4000'], '--port'), '4000');
});

test('getFlag returns undefined when the flag is absent', () => {
  assert.equal(getFlag(['--port', '4000'], '--host'), undefined);
});

test('getFlag returns undefined when the flag is the last argument', () => {
  assert.equal(getFlag(['foo', '--port'], '--port'), undefined);
});

test('getFlagOrDefault falls back when the flag is absent', () => {
  assert.equal(getFlagOrDefault([], '--port', '4000'), '4000');
});

test('getFlagOrDefault prefers the provided value', () => {
  assert.equal(getFlagOrDefault(['--port', '9999'], '--port', '4000'), '9999');
});
```

`test/cli.test.ts`:
```ts
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
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/common/args.ts` and `src/cli.ts` don't exist yet (module not found errors).

- [ ] **Step 5: Implement src/common/args.ts, src/common/stdin-relay.ts, src/cli.ts**

`src/common/args.ts`:
```ts
export function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1 || idx === args.length - 1) return undefined;
  return args[idx + 1];
}

export function getFlagOrDefault(args: string[], name: string, fallback: string): string {
  return getFlag(args, name) ?? fallback;
}
```

`src/common/stdin-relay.ts`:
```ts
import readline from 'node:readline';

export function relayStdinLines(onLine: (line: string) => void): readline.Interface {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', onLine);
  return rl;
}
```

`src/cli.ts`:
```ts
#!/usr/bin/env node

const USAGE = `mini-net -- tiny networking fundamentals CLI

Usage:
  mini-net <command> [options]

Commands:
  tcp-chat server --port <n>
  tcp-chat client --host <h> --port <n>
  udp-messenger server --port <n>
  udp-messenger client --host <h> --port <n>
  tls-chat server --port <n>
  tls-chat client --host <h> --port <n>
  dns lookup <hostname>
  dns raw <hostname> [--server <ip>]
  ping <host> [--port <n>] [--count <n>]
  traceroute <host> [--port <n>]

See README.md for full details and examples.
`;

type CommandHandler = (args: string[]) => Promise<void> | void;

const commands = new Map<string, CommandHandler>();

export function registerCommand(name: string, handler: CommandHandler): void {
  commands.set(name, handler);
}

export async function run(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command) {
    process.stdout.write(USAGE);
    return 1;
  }
  if (command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }

  const handler = commands.get(command);
  if (!handler) {
    process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
    return 1;
  }

  await handler(rest);
  return 0;
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests in `test/cli.test.ts` and `test/common/args.test.ts` green.

- [ ] **Step 7: Verify the build compiles and the compiled CLI runs**

Run: `npm run build && node dist/cli.js --help`
Expected: `tsc` exits 0, `dist/cli.js` prints the same USAGE text.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore src/cli.ts src/common/args.ts src/common/stdin-relay.ts test/cli.test.ts test/common/args.test.ts
git commit -m "feat: scaffold mini-net CLI with command dispatcher and shared arg/stdin utils"
```

---

### Task 2: line-framer — the bounded newline-framing guard

**Files:**
- Create: `src/common/line-framer.ts`
- Test: `test/common/line-framer.test.ts`

**Interfaces:**
- Consumes: nothing beyond `node:events`.
- Produces: `class LineFramer extends EventEmitter` with `feed(chunk: Buffer): void` and `reset(): void`, emitting `'line'` (payload: `string`) and `'overflow'` (payload: none), and the exported constant `MAX_LINE_BYTES = 1024`. Consumed by `tcp-chat/server.ts`, `tcp-chat/client.ts`, `tls-chat/server.ts`, `tls-chat/client.ts` in later tasks.

- [ ] **Step 1: Write failing tests**

`test/common/line-framer.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LineFramer, MAX_LINE_BYTES } from '../../src/common/line-framer.js';

test('emits a line event when a newline arrives', () => {
  const framer = new LineFramer();
  const lines: string[] = [];
  framer.on('line', (line: string) => lines.push(line));

  framer.feed(Buffer.from('hello\n'));

  assert.deepEqual(lines, ['hello']);
});

test('emits multiple lines from one chunk, in order', () => {
  const framer = new LineFramer();
  const lines: string[] = [];
  framer.on('line', (line: string) => lines.push(line));

  framer.feed(Buffer.from('one\ntwo\nthree\n'));

  assert.deepEqual(lines, ['one', 'two', 'three']);
});

test('buffers a partial line across chunks until the newline arrives', () => {
  const framer = new LineFramer();
  const lines: string[] = [];
  framer.on('line', (line: string) => lines.push(line));

  framer.feed(Buffer.from('hel'));
  assert.deepEqual(lines, []);
  framer.feed(Buffer.from('lo\n'));
  assert.deepEqual(lines, ['hello']);
});

test('strips a trailing carriage return (CRLF input)', () => {
  const framer = new LineFramer();
  const lines: string[] = [];
  framer.on('line', (line: string) => lines.push(line));

  framer.feed(Buffer.from('hello\r\n'));

  assert.deepEqual(lines, ['hello']);
});

test('emits overflow exactly once when an unterminated line exceeds the byte limit', () => {
  const framer = new LineFramer(16);
  let overflowCount = 0;
  const lines: string[] = [];
  framer.on('line', (line: string) => lines.push(line));
  framer.on('overflow', () => { overflowCount++; });

  framer.feed(Buffer.alloc(20, 'a'));
  framer.feed(Buffer.from('more data with no newline'));

  assert.equal(overflowCount, 1);
  assert.deepEqual(lines, []);
});

test('MAX_LINE_BYTES defaults to 1024', () => {
  assert.equal(MAX_LINE_BYTES, 1024);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/common/line-framer.ts` doesn't exist.

- [ ] **Step 3: Implement src/common/line-framer.ts**

```ts
import { EventEmitter } from 'node:events';

export const MAX_LINE_BYTES = 1024;

export class LineFramer extends EventEmitter {
  #buffer: Buffer = Buffer.alloc(0);
  readonly #maxBytes: number;
  #overflowed = false;

  constructor(maxBytes: number = MAX_LINE_BYTES) {
    super();
    this.#maxBytes = maxBytes;
  }

  feed(chunk: Buffer): void {
    if (this.#overflowed) return;
    this.#buffer = Buffer.concat([this.#buffer, chunk]);

    let newlineIndex = this.#buffer.indexOf(0x0a);
    while (newlineIndex !== -1) {
      const raw = this.#buffer.subarray(0, newlineIndex);
      this.#buffer = this.#buffer.subarray(newlineIndex + 1);
      const line = raw.toString('utf8').replace(/\r$/, '');
      this.emit('line', line);
      newlineIndex = this.#buffer.indexOf(0x0a);
    }

    if (!this.#overflowed && this.#buffer.length > this.#maxBytes) {
      this.#overflowed = true;
      this.emit('overflow');
    }
  }

  reset(): void {
    this.#buffer = Buffer.alloc(0);
    this.#overflowed = false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `line-framer` tests green, previous tasks' tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/common/line-framer.ts test/common/line-framer.test.ts
git commit -m "feat: add bounded LineFramer — the anti-DoS unbounded-input guard"
```

---

### Task 3: Self-signed TLS certificate generation

**Files:**
- Create: `scripts/gen-cert.sh`
- Test: `test/certs.test.ts`

**Interfaces:**
- Consumes: system `openssl`.
- Produces: `certs/server.key` and `certs/server.cert` on disk (gitignored), with SAN covering `localhost` and `127.0.0.1`. Consumed by `tls-chat/server.ts` and `tls-chat/client.ts` in Task 6.

- [ ] **Step 1: Write scripts/gen-cert.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

CERT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/certs"
mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/server.key" ] && [ -f "$CERT_DIR/server.cert" ]; then
  echo "certs already exist in $CERT_DIR, skipping (delete them to regenerate)"
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "error: openssl not found on PATH. Install it (e.g. 'brew install openssl' or 'apt-get install openssl') and re-run." >&2
  exit 1
fi

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.cert" \
  -days 365 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "generated $CERT_DIR/server.key and $CERT_DIR/server.cert"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/gen-cert.sh`

- [ ] **Step 3: Write a failing test that verifies the generated cert's SAN**

`test/certs.test.ts`:
```ts
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
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `certs/server.cert` doesn't exist yet and the script hasn't been proven to work.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the test itself invokes `gen-cert.sh` on first run (since the cert is missing), then asserts the SAN fields. `certs/server.key` and `certs/server.cert` now exist locally (gitignored, not committed).

- [ ] **Step 6: Commit**

```bash
git add scripts/gen-cert.sh test/certs.test.ts
git commit -m "feat: add self-signed TLS cert generation script with SAN + test"
```

---

### Task 4: TCP chat (server + client)

**Files:**
- Create: `src/tcp-chat/server.ts`
- Create: `src/tcp-chat/client.ts`
- Modify: `src/cli.ts` (register `tcp-chat` command)
- Test: `test/tcp-chat.test.ts`

**Interfaces:**
- Consumes: `LineFramer`, `MAX_LINE_BYTES` from `../common/line-framer.js`; `getFlagOrDefault` from `../common/args.js`; `relayStdinLines` from `../common/stdin-relay.js`; `registerCommand` from `./cli.js`.
- Produces: `startTcpChatServer(port: number): net.Server`, `connectTcpChatClient(host: string, port: number): net.Socket`, `runServerCommand(args: string[]): Promise<void>`, `runClientCommand(args: string[]): Promise<void>`.

- [ ] **Step 1: Write failing integration tests**

`test/tcp-chat.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/tcp-chat/server.ts` doesn't exist.

- [ ] **Step 3: Implement src/tcp-chat/server.ts and src/tcp-chat/client.ts**

`src/tcp-chat/server.ts`:
```ts
import net from 'node:net';
import { LineFramer, MAX_LINE_BYTES } from '../common/line-framer.js';
import { getFlagOrDefault } from '../common/args.js';

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
```

`src/tcp-chat/client.ts`:
```ts
import net from 'node:net';
import { LineFramer } from '../common/line-framer.js';
import { getFlagOrDefault } from '../common/args.js';
import { relayStdinLines } from '../common/stdin-relay.js';

export function connectTcpChatClient(host: string, port: number): net.Socket {
  const socket = net.createConnection({ host, port });
  const framer = new LineFramer();

  socket.on('connect', () => console.log(`[tcp-chat] connected to ${host}:${port}`));
  framer.on('line', (line: string) => console.log(line));
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
```

- [ ] **Step 4: Register the command in src/cli.ts**

Modify `src/cli.ts` — add near the top (after the `registerCommand`/`run` definitions, before the `isMainModule` block):
```ts
import { runServerCommand as tcpChatServer } from './tcp-chat/server.js';
import { runClientCommand as tcpChatClient } from './tcp-chat/client.js';

registerCommand('tcp-chat', async (args) => {
  const [sub, ...rest] = args;
  if (sub === 'server') return tcpChatServer(rest);
  if (sub === 'client') return tcpChatClient(rest);
  process.stderr.write('Usage: mini-net tcp-chat <server|client> [options]\n');
});
```
(Move the `isMainModule` block to remain the last thing in the file, unchanged.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `tcp-chat` tests green, plus every earlier task's tests still green.

- [ ] **Step 6: Verify the build and manually smoke the CLI**

Run: `npm run build && node dist/cli.js tcp-chat server --port 4000 &` then in another shell `node dist/cli.js tcp-chat client --host localhost --port 4000`, type a line, confirm no crash, then stop the server process.
Expected: server prints `listening on port 4000`; client prints `connected to localhost:4000`.

- [ ] **Step 7: Commit**

```bash
git add src/tcp-chat src/cli.ts test/tcp-chat.test.ts
git commit -m "feat: add multi-client TCP chat server/client with framing guard"
```

---

### Task 5: UDP messenger (server + client)

**Files:**
- Create: `src/udp-messenger/server.ts`
- Create: `src/udp-messenger/client.ts`
- Modify: `src/cli.ts` (register `udp-messenger` command)
- Test: `test/udp-messenger.test.ts`

**Interfaces:**
- Consumes: `getFlagOrDefault` from `../common/args.js`; `relayStdinLines` from `../common/stdin-relay.js`; `registerCommand` from `./cli.js`.
- Produces: `startUdpMessengerServer(port: number): dgram.Socket`, `UDP_MAX_MESSAGE_BYTES` constant, `connectUdpMessengerClient(host: string, port: number, idleTimeoutMs?: number): dgram.Socket`, `DEFAULT_IDLE_TIMEOUT_MS` constant, `runServerCommand(args: string[]): Promise<void>`, `runClientCommand(args: string[]): Promise<void>`.

- [ ] **Step 1: Write failing integration tests**

`test/udp-messenger.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/udp-messenger/server.ts` doesn't exist.

- [ ] **Step 3: Implement src/udp-messenger/server.ts and src/udp-messenger/client.ts**

`src/udp-messenger/server.ts`:
```ts
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

  socket.on('error', (err) => console.warn(`[udp-messenger] socket error: ${err.message}`));
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
```

`src/udp-messenger/client.ts`:
```ts
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
```

- [ ] **Step 4: Register the command in src/cli.ts**

Modify `src/cli.ts` — add alongside the `tcp-chat` registration:
```ts
import { runServerCommand as udpMessengerServer } from './udp-messenger/server.js';
import { runClientCommand as udpMessengerClient } from './udp-messenger/client.js';

registerCommand('udp-messenger', async (args) => {
  const [sub, ...rest] = args;
  if (sub === 'server') return udpMessengerServer(rest);
  if (sub === 'client') return udpMessengerClient(rest);
  process.stderr.write('Usage: mini-net udp-messenger <server|client> [options]\n');
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `udp-messenger` tests green, plus every earlier task's tests still green.

- [ ] **Step 6: Commit**

```bash
git add src/udp-messenger src/cli.ts test/udp-messenger.test.ts
git commit -m "feat: add UDP messenger with connected-mode client and idle timeout"
```

---

### Task 6: TLS chat (server + client) over the self-signed cert

**Files:**
- Create: `src/tls-chat/server.ts`
- Create: `src/tls-chat/client.ts`
- Modify: `src/cli.ts` (register `tls-chat` command)
- Test: `test/tls-chat.test.ts`

**Interfaces:**
- Consumes: `LineFramer`, `MAX_LINE_BYTES` from `../common/line-framer.js`; `getFlagOrDefault` from `../common/args.js`; `relayStdinLines` from `../common/stdin-relay.js`; `registerCommand` from `./cli.js`; `certs/server.key` and `certs/server.cert` from Task 3.
- Produces: `startTlsChatServer(port: number, certDir?: string): tls.Server`, `connectTlsChatClient(host: string, port: number, certDir?: string): tls.TLSSocket`, `runServerCommand`, `runClientCommand`.

- [ ] **Step 1: Write failing integration tests**

`test/tls-chat.test.ts`:
```ts
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
  await Promise.all([once(a, 'secureConnect'), once(b, 'secureConnect')]);

  assert.equal(a.authorized, true);
  assert.equal(b.authorized, true);

  const bMessages: string[] = [];
  b.on('data', (chunk) => bMessages.push(chunk.toString()));

  a.write('hello over tls\n');
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(bMessages.length, 1);
  assert.match(bMessages[0], /hello over tls/);

  a.destroy();
  b.destroy();
  server.close();
});

test('TLS server disconnects a client sending an oversized unterminated line', async () => {
  ensureCerts();
  const server = startTlsChatServer(0, certDir);
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;

  const client = connectTlsChatClient('localhost', port, certDir);
  await once(client, 'secureConnect');

  const closed = once(client, 'close');
  client.write(Buffer.alloc(2000, 'a'));
  await closed;

  server.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/tls-chat/server.ts` doesn't exist.

- [ ] **Step 3: Implement src/tls-chat/server.ts and src/tls-chat/client.ts**

`src/tls-chat/server.ts`:
```ts
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineFramer, MAX_LINE_BYTES } from '../common/line-framer.js';
import { getFlagOrDefault } from '../common/args.js';

const defaultCertDir = path.resolve(fileURLToPath(import.meta.url), '../../../certs');

export function startTlsChatServer(port: number, certDir: string = defaultCertDir): tls.Server {
  const options: tls.TlsOptions = {
    key: fs.readFileSync(path.join(certDir, 'server.key')),
    cert: fs.readFileSync(path.join(certDir, 'server.cert')),
  };

  const clients = new Set<tls.TLSSocket>();

  const server = tls.createServer(options, (socket) => {
    clients.add(socket);
    const address = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[tls-chat] connected: ${address}`);

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
      console.warn(`[tls-chat] ${address} exceeded ${MAX_LINE_BYTES}-byte line limit, disconnecting`);
      socket.write('ERROR: line too long, closing connection\n', () => socket.destroy());
    });

    socket.on('data', (chunk) => framer.feed(chunk));
    socket.on('timeout', () => {
      console.log(`[tls-chat] ${address} timed out (idle 60s)`);
      socket.end();
    });
    socket.on('close', () => {
      clients.delete(socket);
      console.log(`[tls-chat] disconnected: ${address}`);
    });
    socket.on('error', (err) => console.warn(`[tls-chat] socket error from ${address}: ${err.message}`));
  });

  server.listen(port, () => {
    const addr = server.address();
    const boundPort = typeof addr === 'object' && addr ? addr.port : port;
    console.log(`[tls-chat] server listening on port ${boundPort}`);
  });

  return server;
}

export async function runServerCommand(args: string[]): Promise<void> {
  const port = Number(getFlagOrDefault(args, '--port', '4443'));
  startTlsChatServer(port);
}
```

`src/tls-chat/client.ts`:
```ts
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineFramer } from '../common/line-framer.js';
import { getFlagOrDefault } from '../common/args.js';
import { relayStdinLines } from '../common/stdin-relay.js';

const defaultCertDir = path.resolve(fileURLToPath(import.meta.url), '../../../certs');

export function connectTlsChatClient(host: string, port: number, certDir: string = defaultCertDir): tls.TLSSocket {
  const ca = fs.readFileSync(path.join(certDir, 'server.cert'));
  // rejectUnauthorized stays at its default (true): we pin the CA instead of
  // disabling verification, so a mismatched or expired cert still fails closed.
  const socket = tls.connect({ host, port, ca });
  const framer = new LineFramer();

  socket.on('secureConnect', () => {
    console.log(`[tls-chat] TLS connected to ${host}:${port} (authorized: ${socket.authorized})`);
  });
  framer.on('line', (line: string) => console.log(line));
  socket.on('data', (chunk) => framer.feed(chunk));

  socket.setTimeout(60_000);
  socket.on('timeout', () => {
    console.log('[tls-chat] connection idle timeout, closing');
    socket.end();
  });
  socket.on('close', () => console.log('[tls-chat] connection closed'));
  socket.on('error', (err) => console.warn(`[tls-chat] connection error: ${err.message}`));

  return socket;
}

export async function runClientCommand(args: string[]): Promise<void> {
  const host = getFlagOrDefault(args, '--host', 'localhost');
  const port = Number(getFlagOrDefault(args, '--port', '4443'));
  const socket = connectTlsChatClient(host, port);
  const rl = relayStdinLines((line) => socket.write(`${line}\n`));
  socket.on('close', () => rl.close());
}
```

- [ ] **Step 4: Register the command in src/cli.ts**

Modify `src/cli.ts` — add alongside the other registrations:
```ts
import { runServerCommand as tlsChatServer } from './tls-chat/server.js';
import { runClientCommand as tlsChatClient } from './tls-chat/client.js';

registerCommand('tls-chat', async (args) => {
  const [sub, ...rest] = args;
  if (sub === 'server') return tlsChatServer(rest);
  if (sub === 'client') return tlsChatClient(rest);
  process.stderr.write('Usage: mini-net tls-chat <server|client> [options]\n');
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `tls-chat` tests green (cert auto-generated by the test on first run if missing), plus every earlier task's tests still green.

- [ ] **Step 6: Commit**

```bash
git add src/tls-chat src/cli.ts test/tls-chat.test.ts
git commit -m "feat: add TLS chat with pinned-CA verification over self-signed cert"
```

---

### Task 7: DNS resolver — built-in wrapper + hand-rolled raw UDP query

**Files:**
- Create: `src/dns/lookup.ts`
- Create: `src/dns/raw-query.ts`
- Modify: `src/cli.ts` (register `dns` command)
- Test: `test/dns.test.ts`

**Interfaces:**
- Consumes: `getFlagOrDefault` from `../common/args.js`; `registerCommand` from `./cli.js`.
- Produces: `lookupHostname(hostname: string): Promise<{ hostname: string; addresses: string[] }>`; `encodeQuery(hostname: string, id: number): Buffer`; `decodeResponse(buf: Buffer, expectedId: number): { address: string; ttl: number }[]`; `rawDnsQuery(hostname: string, server?: string): Promise<{ address: string; ttl: number }[]>`; `runLookupCommand`, `runRawCommand`.

- [ ] **Step 1: Write failing tests**

`test/dns.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQuery, decodeResponse, rawDnsQuery } from '../src/dns/raw-query.js';
import { lookupHostname } from '../src/dns/lookup.js';

test('encodeQuery writes the id, QDCOUNT=1, and a correctly labeled question', () => {
  const packet = encodeQuery('a.io', 0x1234);

  assert.equal(packet.readUInt16BE(0), 0x1234); // id
  assert.equal(packet.readUInt16BE(4), 1); // qdcount

  const question = packet.subarray(12);
  assert.deepEqual(
    [...question],
    [1, 'a'.charCodeAt(0), 2, 'i'.charCodeAt(0), 'o'.charCodeAt(0), 0, 0, 1, 0, 1],
  );
});

test('decodeResponse parses an A record reached through a compression pointer', () => {
  const id = 0xabcd;
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x8180, 2); // response, recursion available, rcode 0
  header.writeUInt16BE(1, 4); // qdcount
  header.writeUInt16BE(1, 6); // ancount

  const qname = Buffer.from([1, 'a'.charCodeAt(0), 0]); // "a"
  const qtypeQclass = Buffer.from([0, 1, 0, 1]);

  const answerName = Buffer.from([0xc0, 0x0c]); // pointer to offset 12 (the question name)
  const answerFixed = Buffer.alloc(10);
  answerFixed.writeUInt16BE(1, 0); // type A
  answerFixed.writeUInt16BE(1, 2); // class IN
  answerFixed.writeUInt32BE(300, 4); // ttl
  answerFixed.writeUInt16BE(4, 8); // rdlength
  const rdata = Buffer.from([93, 184, 216, 34]);

  const packet = Buffer.concat([header, qname, qtypeQclass, answerName, answerFixed, rdata]);

  assert.deepEqual(decodeResponse(packet, id), [{ address: '93.184.216.34', ttl: 300 }]);
});

test('decodeResponse rejects a response whose id does not match the query', () => {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x1111, 0);
  assert.throws(() => decodeResponse(header, 0x2222), /id mismatch/);
});

test('decodeResponse throws on a non-zero rcode', () => {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x1111, 0);
  header.writeUInt16BE(0x8183, 2); // rcode 3 = NXDOMAIN
  header.writeUInt16BE(0, 4);
  header.writeUInt16BE(0, 6);
  assert.throws(() => decodeResponse(header, 0x1111), /error code 3/);
});

test('rawDnsQuery resolves a real hostname against 8.8.8.8 (requires network)', async (t) => {
  try {
    const answers = await rawDnsQuery('example.com');
    assert.ok(answers.length > 0);
    assert.match(answers[0].address, /^\d+\.\d+\.\d+\.\d+$/);
  } catch (err) {
    t.skip(`no network access to 8.8.8.8:53 (${(err as Error).message})`);
  }
});

test('lookupHostname resolves a real hostname via the built-in dns module (requires network)', async (t) => {
  try {
    const result = await lookupHostname('example.com');
    assert.ok(result.addresses.length > 0);
  } catch (err) {
    t.skip(`no network access (${(err as Error).message})`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/dns/raw-query.ts` and `src/dns/lookup.ts` don't exist.

- [ ] **Step 3: Implement src/dns/lookup.ts and src/dns/raw-query.ts**

`src/dns/lookup.ts`:
```ts
import dns from 'node:dns/promises';

export interface LookupResult {
  hostname: string;
  addresses: string[];
}

export async function lookupHostname(hostname: string): Promise<LookupResult> {
  const addresses = await dns.resolve4(hostname);
  return { hostname, addresses };
}

export async function runLookupCommand(args: string[]): Promise<void> {
  const [hostname] = args;
  if (!hostname) {
    console.error('Usage: mini-net dns lookup <hostname>');
    return;
  }
  const result = await lookupHostname(hostname);
  console.log(`${result.hostname} -> ${result.addresses.join(', ')}`);
}
```

`src/dns/raw-query.ts`:
```ts
import dgram from 'node:dgram';
import { randomInt } from 'node:crypto';
import { getFlagOrDefault } from '../common/args.js';

const DNS_PORT = 53;
const QUERY_TIMEOUT_MS = 3000;
const TYPE_A = 1;
const CLASS_IN = 1;

export function encodeQuery(hostname: string, id: number): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2); // flags: recursion desired
  header.writeUInt16BE(1, 4); // qdcount = 1

  const labels = hostname.split('.').map((label) => {
    const buf = Buffer.from(label, 'ascii');
    return Buffer.concat([Buffer.from([buf.length]), buf]);
  });
  const qname = Buffer.concat([...labels, Buffer.from([0])]);

  const qtypeQclass = Buffer.alloc(4);
  qtypeQclass.writeUInt16BE(TYPE_A, 0);
  qtypeQclass.writeUInt16BE(CLASS_IN, 2);

  return Buffer.concat([header, qname, qtypeQclass]);
}

function skipName(buf: Buffer, offset: number): number {
  while (true) {
    const len = buf[offset];
    if (len === undefined) throw new Error('truncated DNS name');
    if ((len & 0xc0) === 0xc0) return offset + 2; // compression pointer: always 2 bytes
    if (len === 0) return offset + 1; // root label
    offset += 1 + len;
  }
}

export interface DnsAnswer {
  address: string;
  ttl: number;
}

export function decodeResponse(buf: Buffer, expectedId: number): DnsAnswer[] {
  if (buf.length < 12) throw new Error('DNS response too short');

  const id = buf.readUInt16BE(0);
  if (id !== expectedId) throw new Error('DNS response id mismatch');

  const flags = buf.readUInt16BE(2);
  const rcode = flags & 0x000f;
  if (rcode !== 0) throw new Error(`DNS server returned error code ${rcode}`);

  const qdcount = buf.readUInt16BE(4);
  const ancount = buf.readUInt16BE(6);

  let offset = 12;
  for (let i = 0; i < qdcount; i++) {
    offset = skipName(buf, offset);
    offset += 4; // qtype + qclass
  }

  const answers: DnsAnswer[] = [];
  for (let i = 0; i < ancount; i++) {
    offset = skipName(buf, offset);
    const type = buf.readUInt16BE(offset);
    const ttl = buf.readUInt32BE(offset + 4);
    const rdlength = buf.readUInt16BE(offset + 8);
    const rdataOffset = offset + 10;

    if (type === TYPE_A && rdlength === 4) {
      const address = `${buf[rdataOffset]}.${buf[rdataOffset + 1]}.${buf[rdataOffset + 2]}.${buf[rdataOffset + 3]}`;
      answers.push({ address, ttl });
    }

    offset = rdataOffset + rdlength;
  }

  return answers;
}

export function rawDnsQuery(hostname: string, server = '8.8.8.8'): Promise<DnsAnswer[]> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const id = randomInt(0, 65536);
    const query = encodeQuery(hostname, id);

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`DNS query to ${server} timed out after ${QUERY_TIMEOUT_MS}ms`));
    }, QUERY_TIMEOUT_MS);

    socket.on('message', (msg) => {
      clearTimeout(timer);
      socket.close();
      try {
        resolve(decodeResponse(msg, id));
      } catch (err) {
        reject(err);
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.send(query, DNS_PORT, server);
  });
}

export async function runRawCommand(args: string[]): Promise<void> {
  const [hostname] = args;
  if (!hostname) {
    console.error('Usage: mini-net dns raw <hostname> [--server <ip>]');
    return;
  }
  const server = getFlagOrDefault(args, '--server', '8.8.8.8');
  const answers = await rawDnsQuery(hostname, server);
  if (answers.length === 0) {
    console.log(`${hostname}: no A records in response (may be CNAME-only)`);
    return;
  }
  for (const a of answers) {
    console.log(`${hostname} -> ${a.address} (ttl ${a.ttl}s)`);
  }
}
```

- [ ] **Step 4: Register the command in src/cli.ts**

Modify `src/cli.ts` — add alongside the other registrations:
```ts
import { runLookupCommand } from './dns/lookup.js';
import { runRawCommand } from './dns/raw-query.js';

registerCommand('dns', async (args) => {
  const [sub, ...rest] = args;
  if (sub === 'lookup') return runLookupCommand(rest);
  if (sub === 'raw') return runRawCommand(rest);
  process.stderr.write('Usage: mini-net dns <lookup|raw> <hostname> [options]\n');
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — encode/decode unit tests always green; the two network-dependent tests either pass or self-skip via `t.skip` if there's no outbound network access. All earlier tasks' tests still green.

- [ ] **Step 6: Commit**

```bash
git add src/dns src/cli.ts test/dns.test.ts
git commit -m "feat: add DNS resolver — built-in dns wrapper plus hand-rolled raw UDP query"
```

---

### Task 8: Latency measurement — TCP RTT ping + traceroute hop count

**Files:**
- Create: `src/latency/tcp-ping.ts`
- Create: `src/latency/traceroute.ts`
- Modify: `src/cli.ts` (register `ping` and `traceroute` commands)
- Test: `test/latency.test.ts`

**Interfaces:**
- Consumes: `getFlagOrDefault` from `../common/args.js`; `registerCommand` from `./cli.js`.
- Produces: `tcpPingOnce(host, port, timeoutMs?): Promise<number>`, `tcpPing(host, port, count): Promise<PingResult[]>`, `summarize(results): { min; avg; max; lost } | null`, `runPingCommand`; `countHops(host): Promise<{ hopCount: number | null; raw: string }>`, `runTracerouteCommand`.

- [ ] **Step 1: Write failing tests**

`test/latency.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { tcpPingOnce, summarize } from '../src/latency/tcp-ping.js';
import { countHops } from '../src/latency/traceroute.js';

test('tcpPingOnce measures a real connect RTT against a local server', async () => {
  const server = net.createServer((socket) => socket.end());
  server.listen(0);
  await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;

  const rtt = await tcpPingOnce('127.0.0.1', port);
  assert.ok(rtt >= 0 && rtt < 1000);

  server.close();
});

test('tcpPingOnce rejects when the connection is refused', async () => {
  await assert.rejects(() => tcpPingOnce('127.0.0.1', 1));
});

test('summarize computes min/avg/max and counts losses', () => {
  const summary = summarize([
    { attempt: 1, rttMs: 10 },
    { attempt: 2, rttMs: 20 },
    { attempt: 3, rttMs: null, error: 'boom' },
  ]);
  assert.deepEqual(summary, { min: 10, avg: 15, max: 20, lost: 1 });
});

test('summarize returns null when every attempt failed', () => {
  assert.equal(summarize([{ attempt: 1, rttMs: null, error: 'x' }]), null);
});

test('countHops against localhost either returns a result or a clear "not installed" error', async (t) => {
  try {
    const result = await countHops('127.0.0.1');
    assert.ok(result.hopCount === null || result.hopCount >= 0);
  } catch (err) {
    assert.match((err as Error).message, /not installed|PATH/);
    t.skip('traceroute/tracert not available in this environment');
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/latency/tcp-ping.ts` and `src/latency/traceroute.ts` don't exist.

- [ ] **Step 3: Implement src/latency/tcp-ping.ts and src/latency/traceroute.ts**

`src/latency/tcp-ping.ts`:
```ts
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { getFlagOrDefault } from '../common/args.js';

export interface PingResult {
  attempt: number;
  rttMs: number | null;
  error?: string;
}

export function tcpPingOnce(host: string, port: number, timeoutMs = 3000): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const socket = net.createConnection({ host, port, timeout: timeoutMs });

    socket.on('connect', () => {
      const rtt = performance.now() - start;
      socket.destroy();
      resolve(rtt);
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`connection to ${host}:${port} timed out after ${timeoutMs}ms`));
    });
    socket.on('error', (err) => reject(err));
  });
}

export async function tcpPing(host: string, port: number, count: number): Promise<PingResult[]> {
  const results: PingResult[] = [];
  for (let attempt = 1; attempt <= count; attempt++) {
    try {
      const rttMs = await tcpPingOnce(host, port);
      results.push({ attempt, rttMs });
    } catch (err) {
      results.push({ attempt, rttMs: null, error: (err as Error).message });
    }
  }
  return results;
}

export function summarize(results: PingResult[]): { min: number; avg: number; max: number; lost: number } | null {
  const rtts = results.map((r) => r.rttMs).filter((v): v is number => v !== null);
  if (rtts.length === 0) return null;
  return {
    min: Math.min(...rtts),
    avg: rtts.reduce((a, b) => a + b, 0) / rtts.length,
    max: Math.max(...rtts),
    lost: results.length - rtts.length,
  };
}

export async function runPingCommand(args: string[]): Promise<void> {
  const [host] = args;
  if (!host) {
    console.error('Usage: mini-net ping <host> [--port <n>] [--count <n>]');
    return;
  }
  const port = Number(getFlagOrDefault(args, '--port', '80'));
  const count = Number(getFlagOrDefault(args, '--count', '4'));

  const results = await tcpPing(host, port, count);
  for (const r of results) {
    if (r.rttMs !== null) {
      console.log(`attempt ${r.attempt}: connected to ${host}:${port} in ${r.rttMs.toFixed(1)}ms`);
    } else {
      console.log(`attempt ${r.attempt}: failed (${r.error})`);
    }
  }
  const summary = summarize(results);
  if (summary) {
    console.log(
      `rtt min/avg/max = ${summary.min.toFixed(1)}/${summary.avg.toFixed(1)}/${summary.max.toFixed(1)} ms, ${summary.lost}/${results.length} lost`,
    );
  } else {
    console.log('all attempts failed');
  }
}
```

`src/latency/traceroute.ts`:
```ts
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { tcpPing, summarize } from './tcp-ping.js';
import { getFlagOrDefault } from '../common/args.js';

const execFileAsync = promisify(execFile);
const TRACEROUTE_TIMEOUT_MS = 15_000;

export interface HopResult {
  hopCount: number | null;
  raw: string;
}

export async function countHops(host: string): Promise<HopResult> {
  const isWindows = os.platform() === 'win32';
  const command = isWindows ? 'tracert' : 'traceroute';
  const args = isWindows ? ['-h', '30', host] : ['-m', '30', host];

  try {
    const { stdout } = await execFileAsync(command, args, { timeout: TRACEROUTE_TIMEOUT_MS });
    const hopLines = stdout.split('\n').filter((line) => /^\s*\d+\s/.test(line));
    return { hopCount: hopLines.length, raw: stdout };
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      throw new Error(
        `'${command}' is not installed or not on PATH. Install it (Linux: 'apt-get install traceroute'; Windows ships 'tracert' by default) and retry.`,
      );
    }
    throw err;
  }
}

export async function runTracerouteCommand(args: string[]): Promise<void> {
  const [host] = args;
  if (!host) {
    console.error('Usage: mini-net traceroute <host> [--port <n>]');
    return;
  }
  const port = Number(getFlagOrDefault(args, '--port', '80'));

  const pingResults = await tcpPing(host, port, 4);
  const summary = summarize(pingResults);
  if (summary) {
    console.log(
      `tcp rtt min/avg/max = ${summary.min.toFixed(1)}/${summary.avg.toFixed(1)}/${summary.max.toFixed(1)} ms`,
    );
  } else {
    console.log('tcp ping: all attempts failed');
  }

  try {
    const hops = await countHops(host);
    console.log(`hop count: ${hops.hopCount ?? 'unknown'}`);
  } catch (err) {
    console.error(`traceroute failed: ${(err as Error).message}`);
  }
}
```

- [ ] **Step 4: Register the commands in src/cli.ts**

Modify `src/cli.ts` — add alongside the other registrations:
```ts
import { runPingCommand } from './latency/tcp-ping.js';
import { runTracerouteCommand } from './latency/traceroute.js';

registerCommand('ping', runPingCommand);
registerCommand('traceroute', runTracerouteCommand);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `latency` tests green (the `countHops` test self-skips if `traceroute`/`tracert` isn't installed), plus every earlier task's tests still green.

- [ ] **Step 6: Commit**

```bash
git add src/latency src/cli.ts test/latency.test.ts
git commit -m "feat: add TCP RTT ping and traceroute-style hop counting"
```

---

### Task 9: README + final end-to-end verification

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: nothing new (documents everything built in Tasks 1-8).
- Produces: nothing consumed by other tasks (this is the last task).

- [ ] **Step 1: Write README.md**

Include, at minimum, these sections (write full prose, not placeholders):
1. **What this is** — one paragraph, the CLI's purpose and non-goals (mirror the spec's Purpose/Non-goals).
2. **Install & run** — `npm install`, `npm run gen-cert` (before using `tls-chat`), `npm run build`, `node dist/cli.js <command>` (or `npm run dev -- <command>` for local iteration), `npm test`.
3. **Commands** — a table: command, what it demonstrates, example invocation, for all of `tcp-chat`, `udp-messenger`, `tls-chat`, `dns lookup`, `dns raw`, `ping`, `traceroute`.
4. **OSI layer map** — a table mapping each command to the OSI layer(s) it operates at: `net`/`dgram`/`tls` sockets = Transport (L4, TCP/UDP) riding on IP (L3); `tls-chat`'s handshake = Session/Presentation (L5/L6) concerns (encryption, session keys) layered on L4; `dns` = Application (L7) protocol that itself runs as a UDP/L4 payload; `ping`/`traceroute` = conceptually ICMP/L3, approximated here via TCP-connect timing (L4) plus shelling out to the OS's L3 tool, since Node has no raw-socket L3 access without root/native code — state this limitation explicitly.
5. **TCP vs UDP** — explain connection-oriented + ordered + reliable (TCP, via handshake/ACKs/retransmission) vs connectionless + unordered + best-effort (UDP), and why `tcp-chat`/`tls-chat` chose TCP (need ordered, reliable delivery for chat) while `udp-messenger` and the raw DNS query chose UDP (low overhead, one-shot request/response, application handles any needed reliability).
6. **DNS** — explain the resolution flow (stub resolver -> recursive resolver -> root -> TLD -> authoritative), and connect it to `dns/raw-query.ts`: a DNS query is fundamentally one UDP datagram out, one UDP datagram back, with a 12-byte header, a question section, and (usually) name-compression pointers in the answer — exactly what the hand-rolled encoder/decoder implements.
7. **TLS handshake** — explain the flow at a level matching what `tls-chat` actually does: ClientHello/ServerHello (cipher negotiation), server presents its certificate, client validates it against a trusted CA (here: the pinned self-signed cert via the `ca` option, `rejectUnauthorized` left at its default `true`), key exchange derives a shared symmetric session key, then application data is encrypted with that key. Note explicitly that the demo does **not** disable certificate verification — it pins the specific self-signed CA, which is the realistic pattern for private/internal services.
8. **Bandwidth, hops, and CDNs vs response time** — explain that RTT is dominated by propagation delay (which grows with hop count / physical distance) plus per-hop queuing/processing delay, that available bandwidth mostly matters for transfer *duration* of larger payloads (not the initial RTT), and that CDNs reduce response time primarily by cutting the number of hops/physical distance to a nearby edge server (and by caching, avoiding a round trip to origin entirely) — tie this back to what `ping`/`traceroute` actually measure (connect-time RTT and hop count) as the observable proxies for this.
9. **The vulnerability mitigated** — explicitly: unbounded input leading to memory-exhaustion DoS, how it's exploitable (a client streams bytes with no `\n` and the server naively concatenates forever), and how `src/common/line-framer.ts`'s `MAX_LINE_BYTES` (1024-byte) guard mitigates it (destroys the connection once the unterminated buffer exceeds the limit) — with an explicit scope note that this guards specifically against unterminated/oversized-line buffering, not SYN floods or distributed UDP floods.
10. **Project layout** — short tree, one line per top-level file/directory.

- [ ] **Step 2: Run the full test suite one more time**

Run: `npm test`
Expected: PASS — every test file from Tasks 1-8 green in one run.

- [ ] **Step 3: Verify a clean build and a manual end-to-end smoke of two features**

Run: `npm run build`
Expected: exits 0, `dist/cli.js` present.

Then manually: start `node dist/cli.js tcp-chat server --port 4000` in one terminal, connect with `node dist/cli.js tcp-chat client --host localhost --port 4000` in another, send a line, confirm it's not echoed to the sender; then `node dist/cli.js dns lookup example.com` and confirm it prints at least one IP address.
Expected: both behave as described in the README.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README mapping mini-net to OSI layers, TCP/UDP, DNS, TLS, and the mitigated vulnerability"
```
