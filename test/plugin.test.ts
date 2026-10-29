import test from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { apply } from '../src/index.ts'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('plugin wires ACP account routes, live adapter and inactivity-aware delegation', () => {
  const providers: unknown[] = []
  const tools: Array<{ name: string; timeoutMs?: number }> = []
  const commands: Array<{ handler: (input: {rawInput: string}) => {kind: string; text: string} }> = []
  const routes: Array<{path: string; handler: (req: IncomingMessage, res: ServerResponse) => void}> = []
  const server = { register: (route: typeof routes[number]) => { routes.push(route); return () => {} } }
  const context = {
    llm: { registerAdapter: (...args: unknown[]) => providers.push(args) },
    commands: { register: (command: typeof commands[number]) => commands.push(command) },
    tools: { register: (tool: typeof tools[number]) => tools.push(tool) },
    get: (name: string) => name === 'webServer' ? server : undefined,
    emit: () => {},
    inject: (_deps: string[], callback: (ctx: unknown) => unknown) => callback(context),
  }
  const previousHome = process.env.DSH_HOME
  const home = mkdtempSync(join(tmpdir(), 'qoder-plugin-'))
  process.env.DSH_HOME = home
  try {
    apply(context as unknown as Context, {enabled: true, askTool: true})
    assert.equal(providers.length, 1)
    assert.equal(tools.length, 1)
    assert.equal(tools[0]!.name, 'qoder_ask')
    assert.equal(tools[0]!.timeoutMs, 2147483647, 'host must not impose the old total request deadline')
    const status = commands[0]!.handler({rawInput: 'status'})
    assert.equal(status.kind, 'success')
    assert.match(status.text, /ACP stdio/)
    assert.match(status.text, /inactivity timeout/)
    assert.match(commands[0]!.handler({rawInput: 'models'}).text, /qoder\/default/)
    assert.equal(commands[0]!.handler({rawInput: 'invalid'}).kind, 'error')
    for (const action of ['accounts', 'accounts/add', 'accounts/update', 'accounts/remove', 'accounts/config']) {
      assert.ok(routes.some(route => route.path === `/plugins/qoder-link/${action}`), `missing ${action}`)
    }
    apply(context as unknown as Context, {enabled: false})
    assert.equal(providers.length, 2, 'disabled adapter remains registered so settings can enable it live')
    const directory = join(home, 'plugins', 'dsh-qoder-link')
    mkdirSync(directory, {recursive: true})
    const path = join(directory, 'settings.json')
    writeFileSync(path, 'SECRET-invalid-json')
    apply(context as unknown as Context, {enabled: true, askTool: true})
    const recovery = commands[2]!.handler({rawInput: 'status'})
    assert.match(recovery.text, /Enabled: false/)
    assert.doesNotMatch(recovery.text, /SECRET/)
    assert.equal(readFileSync(path, 'utf8'), 'SECRET-invalid-json')
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(home, {recursive: true, force: true})
  }
})
