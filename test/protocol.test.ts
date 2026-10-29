import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { QoderProtocol, NdjsonDecoder } from '../src/protocol.ts';

test('NDJSON preserves split UTF8, CRLF, blank lines and flushes final line', () => {
  const decoder = new NdjsonDecoder();
  const bytes = Buffer.from(' {"text":"中文😀"}\r\n\n{"last":true}');
  const results: unknown[] = [];
  for (const byte of bytes) results.push(...decoder.push(Buffer.from([byte])));
  results.push(...decoder.finish());
  assert.deepEqual(results, [{ text: '中文😀' }, { last: true }]);
});
test('NDJSON rejects malformed and oversized lines without content disclosure', () => {
  assert.throws(() => new NdjsonDecoder().push('SECRET\n'), /Invalid Qoder NDJSON/);
  assert.throws(() => new NdjsonDecoder(4).push('12345'), /exceeds limit/);
});
test('partial messages avoid duplicate final text and aggregate usage snapshots', () => {
  const p = new QoderProtocol();
  const stream = (event: unknown) => p.accept({ type: 'stream_event', event });
  stream({ type: 'message_start', message: { id: 'one', usage: { input_tokens: 10, cache_read_input_tokens: 4 } } });
  assert.deepEqual(stream({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'think' } }), [{ type: 'reasoning', delta: 'think' }]);
  assert.deepEqual(stream({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } }), [{ type: 'text', delta: 'hello' }]);
  assert.deepEqual(stream({ type: 'message_delta', usage: { output_tokens: 2 } }), [{ type: 'usage', input: 10, output: 2, cacheRead: 4, cacheWrite: 0 }]);
  assert.deepEqual(p.accept({ type: 'assistant', message: { id: 'one', content: [{ type: 'text', text: 'hello' }, { type: 'thinking', thinking: 'think' }] } }), []);
  assert.deepEqual(p.accept({ type: 'assistant', message: { id: 'two', content: [{ type: 'text', text: '!' }], usage: { input_tokens: 6, output_tokens: 1 } } }), [{ type: 'text', delta: '!' }, { type: 'usage', input: 16, output: 3, cacheRead: 4, cacheWrite: 0 }]);
  assert.deepEqual(p.accept({ type: 'result', session_id: 's', result: 'hello!', structured_output: { x: 1 } }), [{ type: 'result', sessionId: 's', text: 'hello!', structuredOutput: { x: 1 } }]);
});
test('tool start/end normalize and deduplicate; subagent text is excluded', () => {
  const p = new QoderProtocol();
  const tool = { type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a' } };
  assert.deepEqual(p.accept({ type: 'assistant', message: { id: 'm', content: [tool] } }), [{ type: 'tool-start', id: 't1', name: 'Read', input: { path: 'a' } }]);
  assert.deepEqual(p.accept({ type: 'assistant', message: { id: 'm', content: [tool] } }), []);
  assert.deepEqual(p.accept({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }), [{ type: 'tool-end', id: 't1', name: 'Read', output: 'ok', isError: false }]);
  assert.deepEqual(p.accept({ type: 'assistant', parent_tool_use_id: 't1', message: { content: [{ type: 'text', text: 'hidden' }] } }), []);
});
test('synthetic authentication fixture is detected despite exit zero', async () => {
  const fixture = await readFile(new URL('./fixtures/qoder-auth-error.ndjson', import.meta.url));
  const decoder = new NdjsonDecoder();
  const protocol = new QoderProtocol();
  assert.throws(() => { for (const row of decoder.push(fixture)) protocol.accept(row); }, /authentication required/);
});
test('metadata is validated and error contents never become diagnostics', () => {
  const p = new QoderProtocol();
  assert.deepEqual(p.accept({ type: 'system', subtype: 'init', model: 'https://secret@host/model' }), []);
  assert.deepEqual(p.accept({ type: 'system', subtype: 'init', model: 'qoder-model' }), [{ type: 'metadata', model: 'qoder-model' }]);
  assert.throws(() => p.accept({ type: 'error', message: 'SECRET_TOKEN' }), /^Error: Qoder reported a protocol error$/);
  const events = new QoderProtocol().accept({ type: 'result', result: 'ok', total_credits: 3, total_cost_usd: -1, usage: { input_tokens: -4, output_tokens: 2 } });
  assert.ok(events.some(e => e.type === 'metadata' && e.totalCredits === 3 && e.totalCostUsd === undefined));
  assert.ok(events.some(e => e.type === 'usage' && e.input === 0 && e.output === 2));
});
test('duplicate terminal results fail closed', () => {
  const p = new QoderProtocol();
  p.accept({ type: 'result', result: 'done' });
  assert.throws(() => p.accept({ type: 'result', result: 'again' }), /duplicate result/);
});
test('result-only fallback and authentication errors', () => {
  assert.deepEqual(new QoderProtocol().accept({ type: 'result', result: 'fallback' }), [{ type: 'text', delta: 'fallback' }, { type: 'result', text: 'fallback' }]);
  assert.throws(() => new QoderProtocol().accept({ type: 'result', is_error: true, errors: ['401 secret'] }), /authentication required/);
});
test('result text alone signals authentication with a login hint', () => {
  // Synthetic compatibility case: the errors array may be empty.
  assert.throws(() => new QoderProtocol().accept({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: [], result: '401 Unauthorized' }), /authentication required.*qodercli login/);
  assert.throws(() => new QoderProtocol().accept({ type: 'result', is_error: true, errors: [], result: 'boom' }), /^Error: Qoder request failed$/);
});
test('numeric assistant answers are not mistaken for HTTP failures', () => {
  for (const answer of ['400', '401', '404', '429', '500', '599', ' 404\n']) {
    for (const streamed of [false, true]) {
      const protocol = new QoderProtocol();
      if (streamed) {
        protocol.accept({ type: 'stream_event', event: { type: 'message_start', message: { id: 'numeric' } } });
        assert.deepEqual(protocol.accept({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: answer } } }), [{ type: 'text', delta: answer }]);
      }
      assert.deepEqual(protocol.accept({ type: 'assistant', message: { id: 'numeric', content: [{ type: 'text', text: answer }] } }), streamed ? [] : [{ type: 'text', delta: answer }]);
      assert.deepEqual(protocol.accept({ type: 'result', result: answer }), [{ type: 'result', text: answer }]);
    }
  }
});
test('assistant message echoing a bare HTTP status fails fast instead of hanging', () => {
  // Compatibility regression for an echoed error with no terminal result.
  const auth = { type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: '401 Unauthorized' }] } };
  assert.throws(() => new QoderProtocol().accept(auth), /authentication required.*qodercli login/);
  assert.throws(() => new QoderProtocol().accept({ type: 'assistant', message: { id: 'a2', content: [{ type: 'text', text: '429 Too Many Requests' }] } }), /^Error: Qoder request failed \(HTTP error\)$/);
  // A normal reply merely mentioning a status code must keep streaming as text.
  const normal = new QoderProtocol().accept({ type: 'assistant', message: { id: 'a3', content: [{ type: 'text', text: 'HTTP 500 errors usually mean the server had a problem; here is what to check…' }] } });
  assert.ok(normal.some(e => e.type === 'text' && e.delta.includes('HTTP 500')));
  const twoBlocks = new QoderProtocol().accept({ type: 'assistant', message: { id: 'a4', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: '401 Unauthorized' }] } });
  assert.ok(twoBlocks.some(e => e.type === 'text'));
});
