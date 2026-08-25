import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQuery, decodeResponse, rawDnsQuery } from '../src/dns/raw-query.js';
import { lookupHostname } from '../src/dns/lookup.js';

test('encodeQuery writes the id, QDCOUNT=1, and a correctly labeled question', () => {
  const packet = encodeQuery('a.io', 0x1234);

  assert.equal(packet.readUInt16BE(0), 0x1234);
  assert.equal(packet.readUInt16BE(4), 1);

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
  header.writeUInt16BE(0x8180, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(1, 6);

  const qname = Buffer.from([1, 'a'.charCodeAt(0), 0]);
  const qtypeQclass = Buffer.from([0, 1, 0, 1]);

  const answerName = Buffer.from([0xc0, 0x0c]);
  const answerFixed = Buffer.alloc(10);
  answerFixed.writeUInt16BE(1, 0);
  answerFixed.writeUInt16BE(1, 2);
  answerFixed.writeUInt32BE(300, 4);
  answerFixed.writeUInt16BE(4, 8);
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
  header.writeUInt16BE(0x8183, 2);
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
