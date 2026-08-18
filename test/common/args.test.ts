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
