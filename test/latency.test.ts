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
