import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, rm, readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { runQoder, resolveQoderBin, childEnv, type BridgeEvent } from '../src/runner.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const cwd = await mkdtemp(join(tmpdir(), 'qodercli bridge '));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const bin = join(cwd, 'fake cli.mjs');
  await copyFile(fileURLToPath(new URL('./fixtures/fake-cli.mjs', import.meta.url)), bin);
  return { cwd, bin };
}
async function collect(iterator: AsyncIterable<BridgeEvent>): Promise<BridgeEvent[]> {
  const result: BridgeEvent[] = []; for await (const event of iterator) result.push(event); return result;
}

test('runner streams Unicode and unterminated result from a temporary CLI', async t => {
  const f = await fixture(t);
  const events = await collect(runQoder({ ...f, prompt: '中文😀', timeoutMs: 5000 }));
  assert.deepEqual(events[0], { type: 'text', delta: '中文😀' });
  assert.deepEqual(events.at(-1), { type: 'result', sessionId: 'test-session', text: '中文😀', structuredOutput: { ok: true } });
});
test('argv stays literal, disables tools, isolates MCP/settings and never resumes', async t => {
  const f = await fixture(t);
  const injection = 'a & echo INJECTED | " b';
  const events = await collect(runQoder({ ...f, prompt: 'argv', systemPrompt: injection, model: 'm', effort: 'low' }));
  const result = events.at(-1);
  assert.equal(result?.type, 'result');
  if (result?.type !== 'result') return;
  const args: string[] = JSON.parse(result.text);
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.equal(args[args.indexOf('--system-prompt') + 1], injection);
  assert.equal(args[args.indexOf('--reasoning-effort') + 1], 'low');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dont_ask');
  assert.equal(args[args.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
  assert.equal(args[args.indexOf('--setting-sources') + 1], '');
  assert.ok(args.includes('--strict-mcp-config') && args.includes('--no-session-persistence'));
  for (const flag of ['--verbose', '--include-partial-messages', '--effort', '--json-schema']) assert.ok(!args.includes(flag));
  assert.ok(!args.includes('--resume') && !args.includes('--continue'));
});
test('nonzero exits, protocol errors, malformed output and missing results throw safely', async t => {
  const f = await fixture(t);
  for (const prompt of ['error', 'protocol-error', 'malformed', 'missing']) {
    await assert.rejects(collect(runQoder({ ...f, prompt })), error => error instanceof Error && !error.message.includes('SECRET_TOKEN'));
  }
});
test('pre-abort, active abort and timeout are distinct errors', async t => {
  const f = await fixture(t);
  const pre = new AbortController(); pre.abort();
  await assert.rejects(collect(runQoder({ ...f, prompt: 'hang', signal: pre.signal })), { name: 'AbortError' });
  const controller = new AbortController();
  const running = collect(runQoder({ ...f, prompt: 'hang', signal: controller.signal }));
  setTimeout(() => controller.abort(), 150);
  await assert.rejects(running, { name: 'AbortError' });
  await assert.rejects(collect(runQoder({ ...f, prompt: 'hang', timeoutMs: 100 })), { name: 'TimeoutError' });
});
test('abort kills spawned descendant process', async t => {
  const f = await fixture(t);
  const pidFile = join(f.cwd, 'child.pid');
  const controller = new AbortController();
  const outcome = collect(runQoder({ ...f, prompt: `tree:${pidFile}`, signal: controller.signal, timeoutMs: 10000 })).catch(error => error);
  let pid = 0;
  for (let i = 0; i < 100; i++) {
    try { pid = Number(await readFile(pidFile, 'utf8')); break; } catch { await delay(30); }
  }
  controller.abort();
  assert.equal((await outcome).name, 'AbortError');
  assert.ok(pid > 0);
  let alive = true;
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch { alive = false; break; }
    await delay(20);
  }
  assert.equal(alive, false, 'descendant must not survive cancellation');
});
test('consumer early return kills the process tree', async t => {
  const f = await fixture(t);
  const pidFile = join(f.cwd, 'early-child.pid');
  for await (const event of runQoder({ ...f, prompt: `yield-tree:${pidFile}` })) {
    assert.equal(event.type, 'text');
    break;
  }
  const pid = Number(await readFile(pidFile, 'utf8'));
  let alive = true;
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch { alive = false; break; }
    await delay(20);
  }
  assert.equal(alive, false);
});
test('Windows npm shim resolves to JavaScript without shell execution', async t => {
  const f = await fixture(t);
  const target = join(f.cwd, 'node_modules', 'fake', 'cli.js');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, '// fake');
  const shim = join(f.cwd, 'qoder.cmd');
  await writeFile(shim, '@ECHO off\r\n"%dp0%\\node.exe" "%dp0%\\node_modules\\fake\\cli.js" %*\r\n');
  // Explicit Windows shims resolve on all platforms (useful for portable tests).
  if (process.platform !== 'win32') { const { chmod } = await import('node:fs/promises'); await chmod(shim, 0o755); }
  const resolved = await resolveQoderBin(shim, f.cwd);
  assert.equal(resolved.command, process.execPath);
  // Windows runners can expose TEMP through an 8.3 alias; resolver canonicalizes it.
  assert.equal(resolved.args[0], await realpath(target));
});
test('explicit tools and permission choices are passed unchanged', async t => {
  const f = await fixture(t);
  for (const permissionMode of ['default', 'accept_edits'] as const) {
    const events = await collect(runQoder({ ...f, prompt: 'argv', tools: 'Read,Grep', permissionMode }));
    const result = events.at(-1);
    assert.equal(result?.type, 'result');
    if (result?.type !== 'result') continue;
    const args: string[] = JSON.parse(result.text);
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Grep');
    assert.equal(args[args.indexOf('--permission-mode') + 1], permissionMode);
  }
});
test('invalid timeouts and permission modes reject before spawning', async t => {
  const f = await fixture(t);
  for (const timeoutMs of [0, -1, NaN, Infinity, 2_147_483_648]) {
    await assert.rejects(collect(runQoder({ ...f, prompt: '', timeoutMs })), RangeError);
  }
  await assert.rejects(collect(runQoder({ ...f, prompt: '', permissionMode: 'dontAsk' as never })), /Unsupported permissionMode/);
});
test('lifecycle callback errors terminate safely without leaking callback secrets', async t => {
  const f = await fixture(t);
  await assert.rejects(collect(runQoder({ ...f, prompt: 'hang', onSpawn() { throw new Error('SECRET_TOKEN'); } })), /^Error: Qoder lifecycle callback failed$/);
});
test('childEnv forces ELECTRON_RUN_AS_NODE so Electron hosts spawn plain Node children', () => {
  const env = childEnv();
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
  // Windows preserves the original casing (Path) when spreading process.env.
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH');
  assert.equal(pathKey ? env[pathKey] : undefined, process.env.PATH);
  const original = process.env.ELECTRON_RUN_AS_NODE;
  process.env.ELECTRON_RUN_AS_NODE = '0';
  try { assert.equal(childEnv().ELECTRON_RUN_AS_NODE, '1'); }
  finally { if (original === undefined) delete process.env.ELECTRON_RUN_AS_NODE; else process.env.ELECTRON_RUN_AS_NODE = original; }
});
