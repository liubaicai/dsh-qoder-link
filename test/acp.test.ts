import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runQoder, childEnv, type QoderRequest } from '../src/runner.ts';
const bin = fileURLToPath(new URL('./fixtures/fake-acp.mjs', import.meta.url));
async function setup(t: { after(fn: () => Promise<void>): void }) {
  const cwd = await mkdtemp(join(tmpdir(), 'qoder-acp-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return { cwd, bin };
}
async function collect(request: QoderRequest) { const events = []; for await (const event of runQoder(request)) events.push(event); return events; }
test('idle watchdog permits total duration greater than inactivity budget', async t => {
  const f = await setup(t);
  const events = await collect({ ...f, prompt: 'slow', timeoutMs: 500 });
  assert.equal(events.at(-1)?.type, 'result');
});
test('stderr and unrelated notifications do not renew idle watchdog', async t => {
  const f = await setup(t);
  await assert.rejects(collect({ ...f, prompt: 'noise', timeoutMs: 300 }), { name: 'TimeoutError' });
});
test('native tool notifications fail closed with empty tools', async t => {
  const f = await setup(t);
  await assert.rejects(collect({ ...f, prompt: 'tool', tools: '' }));
  const events = await collect({ ...f, prompt: 'tool', tools: 'Read' });
  assert.deepEqual(events.map(e => e.type), ['tool-start', 'tool-end', 'result']);
});
test('permissions are cancelled, never approved', async t => {
  const f = await setup(t);
  await assert.rejects(collect({ ...f, prompt: 'permission' }), /permission request cancelled/);
  const response = JSON.parse(await readFile(join(f.cwd, 'client-response.json'), 'utf8'));
  assert.equal(response.result.outcome.outcome, 'cancelled');
});
test('client filesystem methods receive method-not-found, not file contents', async t => {
  const f = await setup(t);
  await collect({ ...f, prompt: 'client-requests' });
  const response = JSON.parse(await readFile(join(f.cwd, 'client-response.json'), 'utf8'));
  assert.equal(response.error.code, -32601);
});
test('invalid session IDs, frames, unmatched responses and non-end-turn stops fail', async t => {
  const f = await setup(t);
  for (const prompt of ['wrong-session', 'oversized', 'unexpected-id', 'refusal']) await assert.rejects(collect({ ...f, prompt }));
});
test('requested model is selected through ACP when session differs', async t => {
  const f = await setup(t);
  const events = await collect({ ...f, prompt: 'model', model: 'qfmodel' });
  assert.deepEqual(events[0], { type: 'metadata', model: 'qfmodel' });
});
test('standard auth error is named and diagnostics are secret-safe', async t => {
  const f = await setup(t);
  await assert.rejects(collect({ ...f, prompt: 'auth-error', authToken: 'SECRET_TOKEN' }), (e: unknown) => e instanceof Error && e.name === 'QoderAuthError' && !e.message.includes('SECRET_TOKEN'));
});
test('PAT is subprocess-only and regional inherited credentials are cleared', async t => {
  const f = await setup(t);
  const original = process.env.QODER_PERSONAL_ACCESS_TOKEN;
  const cnOriginal = process.env.QODERCN_PERSONAL_ACCESS_TOKEN;
  process.env.QODER_PERSONAL_ACCESS_TOKEN = 'old-international';
  process.env.QODERCN_PERSONAL_ACCESS_TOKEN = 'old-cn';
  try {
    const cn = childEnv('test-cn', 'qoderclicn');
    assert.equal(cn.QODERCN_PERSONAL_ACCESS_TOKEN, 'test-cn');
    assert.equal(cn.QODER_PERSONAL_ACCESS_TOKEN, undefined);
    const international = childEnv('test-pat', 'qodercli');
    assert.equal(international.QODERCN_PERSONAL_ACCESS_TOKEN, undefined);
    assert.equal(international.QODER_PERSONAL_ACCESS_TOKEN, 'test-pat');
    const events = await collect({ ...f, prompt: 'env', authToken: 'test-pat' });
    const result = events.at(-1);
    assert.equal(result?.type === 'result' && result.text, 'true');
    assert.equal(process.env.QODER_PERSONAL_ACCESS_TOKEN, 'old-international');
  } finally {
    if (original === undefined) delete process.env.QODER_PERSONAL_ACCESS_TOKEN; else process.env.QODER_PERSONAL_ACCESS_TOKEN = original;
    if (cnOriginal === undefined) delete process.env.QODERCN_PERSONAL_ACCESS_TOKEN; else process.env.QODERCN_PERSONAL_ACCESS_TOKEN = cnOriginal;
  }
});
