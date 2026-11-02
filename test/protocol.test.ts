import test from 'node:test';
import assert from 'node:assert/strict';
import { NdjsonDecoder } from '../src/protocol.ts';

test('NDJSON preserves split UTF8, CRLF, blank lines and flushes final line', () => {
  const decoder = new NdjsonDecoder();
  const bytes = Buffer.from(' {"text":"中文😀"}\r\n\n{"last":true}');
  const results: unknown[] = [];
  for (const byte of bytes) results.push(...decoder.push(Buffer.from([byte])));
  results.push(...decoder.finish());
  assert.deepEqual(results, [{ text: '中文😀' }, { last: true }]);
});

test('NDJSON omits malformed line contents from push and finish errors', () => {
  const expected = { message: 'Invalid Qoder NDJSON (line content omitted)' };
  assert.throws(() => new NdjsonDecoder().push('SECRET_TOKEN\n'), expected);
  const decoder = new NdjsonDecoder();
  assert.deepEqual(decoder.push('SECRET_TOKEN'), []);
  assert.throws(() => decoder.finish(), expected);
});

test('NDJSON bounds pending and complete lines by UTF8 bytes, not chunk size', () => {
  const line = '"中"'; // Five UTF-8 bytes, but only three UTF-16 code units.
  const decoder = new NdjsonDecoder(5);
  assert.deepEqual(decoder.push(`${line}\n${line}\n${line}`), ['中', '中']);
  assert.deepEqual(decoder.finish(), ['中']);
  for (const suffix of ['', '\n']) {
    assert.throws(() => new NdjsonDecoder(4).push(line + suffix), { message: 'Qoder NDJSON line exceeds limit' });
  }
  const pending = new NdjsonDecoder(4);
  assert.deepEqual(pending.push('1234'), []);
  assert.throws(() => pending.push('5'), { message: 'Qoder NDJSON line exceeds limit' });
});
