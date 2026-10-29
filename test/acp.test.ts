import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runQoder, childEnv, type QoderRequest, type BridgeEvent } from '../src/runner.ts';
const bin = fileURLToPath(new URL('./fixtures/fake-acp.mjs', import.meta.url));
async function setup(t: { after(fn: () => Promise<void>): void }) {
  const cwd = await mkdtemp(join(tmpdir(), 'qoder-acp-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return { cwd, bin };
}
async function collect(request: QoderRequest) { const events = []; for await (const event of runQoder(request)) events.push(event); return events; }
const metadata = [
  { sessionUpdate: 'session_info_update', title: 'Starting' },
  { sessionUpdate: 'current_mode_update', currentModeId: 'default' },
  { sessionUpdate: 'available_commands_update', availableCommands: [] },
  { sessionUpdate: 'config_option_update', configOptions: [] },
  { sessionUpdate: 'usage_update', used: 0, size: 100 },
];
const notifications = (updates: unknown[], sessionId = 'test-session') => updates.map(update => ({ sessionId, update }));
async function dead(cwd: string) {
  const pid = Number(await readFile(join(cwd, 'server.pid'), 'utf8'));
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch { return; }
    await delay(20);
  }
  assert.fail('ACP subprocess survived cleanup');
}

test('validated metadata before session binding and after completion is chunk-independent', async t => {
  for (const phase of ['before', 'after']) for (const split of [false, true]) {
    const f = await setup(t);
    await writeFile(join(f.cwd, 'setup.json'), JSON.stringify({ phase, split, notifications: notifications(metadata) }));
    const events = await collect({ ...f, prompt: 'answer' });
    assert.deepEqual(events.at(-1), { type: 'result', sessionId: 'test-session', text: 'answer' });
    assert.equal(events.some(e => e.type === 'tool-start' || e.type === 'usage' || e.type === 'metadata'), false);
    await dead(f.cwd);
  }
});

test('metadata boundaries reject wrong phases, shapes, session IDs and executing updates', { timeout: 120000 }, async t => {
  const invalid = [
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'SECRET_TOKEN' } },
    { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'SECRET_TOKEN' } },
    { sessionUpdate: 'tool_call', toolCallId: 'never-execute', status: 'pending' },
    { sessionUpdate: 'plan', entries: [] },
    { sessionUpdate: 'future_update' },
    { sessionUpdate: 'current_mode_update', currentModeId: 42 },
    { sessionUpdate: 'available_commands_update', availableCommands: [{}] },
    { sessionUpdate: 'config_option_update', configOptions: [{}] },
    { sessionUpdate: 'usage_update', used: -1, size: 100 },
    { sessionUpdate: 'session_info_update', title: 'ok', _meta: 'SECRET_TOKEN' },
  ];
  for (const phase of ['before', 'after']) {
    const cases = [
      notifications([metadata[0]], 'wrong-session'),
      [...notifications([metadata[0]]), ...notifications([metadata[0]], 'other')],
      ...invalid.map(update => notifications([update])),
    ];
    for (const frames of cases) {
      const f = await setup(t);
      await writeFile(join(f.cwd, 'setup.json'), JSON.stringify({ phase, notifications: frames }));
      const events: BridgeEvent[] = [];
      await assert.rejects(async () => { for await (const event of runQoder({ ...f, prompt: 'answer' })) events.push(event); }, /Invalid or oversized Qoder ACP stream/);
      assert.equal(events.some(e => e.type === 'result' || e.type === 'tool-start'), false);
      if (phase === 'before') {
        assert.deepEqual(events, []);
        assert.equal((await readFile(join(f.cwd, 'wire.ndjson'), 'utf8')).includes('session/prompt'), false);
      }
      await dead(f.cwd);
    }
  }
  const f = await setup(t);
  await writeFile(join(f.cwd, 'setup.json'), JSON.stringify({ early: true, notifications: notifications([metadata[0]]) }));
  await assert.rejects(collect({ ...f, prompt: 'answer' }), /Invalid or oversized Qoder ACP stream/);
  await dead(f.cwd);
});

test('metadata does not renew idle timeout before binding or during the prompt', { timeout: 15000 }, async t => {
  for (const phase of ['before', 'during']) {
    const f = await setup(t);
    await writeFile(join(f.cwd, 'setup.json'), JSON.stringify({ phase, stall: true, notifications: notifications(metadata) }));
    await assert.rejects(collect({ ...f, prompt: 'answer', timeoutMs: 500 }), { name: 'TimeoutError' });
    if (phase === 'before') assert.equal((await readFile(join(f.cwd, 'wire.ndjson'), 'utf8')).includes('session/prompt'), false);
    await dead(f.cwd);
  }
});

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
    for (const cliVariant of ['qodercli', 'qoderclicn'] as const) {
      for (const authToken of [undefined, 'selected-token']) {
        const snapshot = (await collect({ ...f, prompt: 'env-snapshot', cliVariant, authToken })).at(-1);
        assert.equal(snapshot?.type, 'result');
        const expectedKey = cliVariant === 'qoderclicn' ? 'QODERCN_PERSONAL_ACCESS_TOKEN' : 'QODER_PERSONAL_ACCESS_TOKEN';
        assert.deepEqual(snapshot?.type === 'result' ? JSON.parse(snapshot.text) : null, authToken ? { [expectedKey]: authToken } : {});
      }
    }
    assert.equal(process.env.QODER_PERSONAL_ACCESS_TOKEN, 'old-international');
    assert.equal(process.env.QODERCN_PERSONAL_ACCESS_TOKEN, 'old-cn');
  } finally {
    if (original === undefined) delete process.env.QODER_PERSONAL_ACCESS_TOKEN; else process.env.QODER_PERSONAL_ACCESS_TOKEN = original;
    if (cnOriginal === undefined) delete process.env.QODERCN_PERSONAL_ACCESS_TOKEN; else process.env.QODERCN_PERSONAL_ACCESS_TOKEN = cnOriginal;
  }
});
