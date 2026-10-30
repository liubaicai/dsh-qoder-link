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
test('model catalog aliases resolve to canonical IDs before switching or prompting', async t => {
  const availableModels = [
    { modelId: 'qfmodel', name: 'Qwen3.8-Flash' },
    { modelId: 'auto', name: 'Auto (default)' },
    { modelId: 'fast', name: 'Fast (default)' },
    { modelId: 'dynamic-id', name: 'Future-Model' },
    { modelId: 'shadow-id', name: 'qfmodel' },
  ];
  const cases = [
    { requested: 'Qwen3.8-Flash', current: 'qfmodel', target: 'qfmodel', switchModel: false },
    { requested: 'Qwen3.8-Flash', current: 'auto', target: 'qfmodel', switchModel: true },
    { requested: 'qfmodel', current: 'auto', target: 'qfmodel', switchModel: true },
    { requested: 'Auto', current: 'auto', target: 'auto', switchModel: false },
    { requested: 'Fast', current: 'auto', target: 'fast', switchModel: true },
    { requested: 'Future-Model', current: 'auto', target: 'dynamic-id', switchModel: true },
  ];
  for (const entry of cases) {
    const f = await setup(t);
    await writeFile(join(f.cwd, 'setup.json'), JSON.stringify({ models: { currentModelId: entry.current, availableModels } }));
    const events = await collect({ ...f, prompt: 'model', model: entry.requested });
    assert.deepEqual(events[0], { type: 'metadata', model: entry.target });
    const wire = (await readFile(join(f.cwd, 'wire.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(wire[0].params.clientInfo.version, '0.1.4');
    const switches = wire.filter(row => row.method === 'session/set_model');
    assert.deepEqual(switches.map(row => row.params.modelId), entry.switchModel ? [entry.target] : []);
    assert.equal(wire.some(row => row.method === 'session/prompt'), true);
  }
});
test('ambiguous or unknown catalog names fail safely before prompt without fallback', async t => {
  const cases = [
    { requested: 'SECRET_TOKEN', models: { currentModelId: 'a', availableModels: [{ modelId: 'a', name: 'SECRET_TOKEN' }, { modelId: 'b', name: 'SECRET_TOKEN' }] } },
    { requested: 'SECRET_TOKEN', models: { currentModelId: 'SECRET_TOKEN', availableModels: [{ modelId: 'a', name: 'Other' }] } },
    { requested: 'missing', models: { currentModelId: 'a', availableModels: [] } },
    { requested: 'AUTO', models: { currentModelId: 'auto', availableModels: [{ modelId: 'auto', name: 'First' }, { modelId: 'Auto', name: 'Second' }] } },
  ];
  for (const entry of cases) {
    const f = await setup(t);
    await writeFile(join(f.cwd, 'setup.json'), JSON.stringify({ models: entry.models }));
    await assert.rejects(collect({ ...f, prompt: 'model', model: entry.requested }), (error: unknown) => error instanceof Error && /ambiguous|unavailable/.test(error.message) && !error.message.includes('SECRET_TOKEN'));
    const wire = await readFile(join(f.cwd, 'wire.ndjson'), 'utf8');
    assert.equal(wire.includes('session/prompt'), false);
    assert.equal(wire.includes('session/set_model'), false);
  }
});
test('absent model catalog preserves direct-ID compatibility', async t => {
  for (const models of [undefined, { currentModelId: 'other' }, { currentModelId: 'qfmodel' }]) {
    const f = await setup(t);
    await writeFile(join(f.cwd, 'setup.json'), JSON.stringify({ models }));
    const events = await collect({ ...f, prompt: 'model', model: 'qfmodel' });
    assert.deepEqual(events[0], { type: 'metadata', model: 'qfmodel' });
    const wire = (await readFile(join(f.cwd, 'wire.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(wire.filter(row => row.method === 'session/set_model').map(row => row.params.modelId), models?.currentModelId === 'qfmodel' ? [] : ['qfmodel']);
  }
});
test('standard auth error is named and diagnostics are secret-safe', async t => {
  const f = await setup(t);
  await assert.rejects(collect({ ...f, prompt: 'auth-error' }), (e: unknown) => e instanceof Error && e.name === 'QoderAuthError' && !e.message.includes('SECRET_TOKEN'));
});
test('both CLI regions use local login without injecting inherited credentials', async t => {
  const f = await setup(t);
  const original = process.env.QODER_PERSONAL_ACCESS_TOKEN;
  const cnOriginal = process.env.QODERCN_PERSONAL_ACCESS_TOKEN;
  process.env.QODER_PERSONAL_ACCESS_TOKEN = 'old-international';
  process.env.QODERCN_PERSONAL_ACCESS_TOKEN = 'old-cn';
  try {
    const env = childEnv();
    assert.equal(env.QODERCN_PERSONAL_ACCESS_TOKEN, undefined);
    assert.equal(env.QODER_PERSONAL_ACCESS_TOKEN, undefined);
    for (const cliVariant of ['qodercli', 'qoderclicn'] as const) {
      const snapshot = (await collect({ ...f, prompt: 'env-snapshot', cliVariant })).at(-1);
      assert.equal(snapshot?.type, 'result');
      assert.deepEqual(snapshot?.type === 'result' ? JSON.parse(snapshot.text) : null, {});
    }
    assert.equal(process.env.QODER_PERSONAL_ACCESS_TOKEN, 'old-international');
    assert.equal(process.env.QODERCN_PERSONAL_ACCESS_TOKEN, 'old-cn');
  } finally {
    if (original === undefined) delete process.env.QODER_PERSONAL_ACCESS_TOKEN; else process.env.QODER_PERSONAL_ACCESS_TOKEN = original;
    if (cnOriginal === undefined) delete process.env.QODERCN_PERSONAL_ACCESS_TOKEN; else process.env.QODERCN_PERSONAL_ACCESS_TOKEN = cnOriginal;
  }
});
