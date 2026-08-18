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

test('emits overflow for a newline-terminated line exceeding maxBytes', () => {
  const framer = new LineFramer(16);
  let overflowCount = 0;
  const lines: string[] = [];
  framer.on('line', (line: string) => lines.push(line));
  framer.on('overflow', () => { overflowCount++; });

  // Send a line with 17 bytes (16 + 1 byte over limit), newline-terminated
  framer.feed(Buffer.from('a'.repeat(17) + '\n'));

  assert.equal(overflowCount, 1);
  assert.deepEqual(lines, []);
});

test('does not overflow for a newline-terminated line at exactly maxBytes', () => {
  const framer = new LineFramer(16);
  let overflowCount = 0;
  const lines: string[] = [];
  framer.on('line', (line: string) => lines.push(line));
  framer.on('overflow', () => { overflowCount++; });

  // Send a line with exactly 16 bytes, newline-terminated
  framer.feed(Buffer.from('a'.repeat(16) + '\n'));

  assert.equal(overflowCount, 0);
  assert.deepEqual(lines, ['a'.repeat(16)]);
});
