import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { resolveConfig } from '../src/config.ts'

const source = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
type Node = {type: unknown; props: Record<string, any>; children: unknown[]}
function loadClient() {
  const exports: Record<string, any> = {}
  const state: unknown[] = []; const effects: (() => void | (() => void))[] = []; const requests: {url: string; options: any}[] = []
  let cursor = 0
  const react = {
    createElement: (type: unknown, props: Record<string, any>, ...children: unknown[]) => ({type, props, children}),
    useState(initial: unknown) {const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (next: any) => {state[index] = typeof next === 'function' ? next(state[index]) : next}]},
    useRef(initial: unknown) {const index = cursor++; if (!(index in state)) state[index] = {current: initial}; return state[index]},
    useEffect(setup: () => void | (() => void)) {if (!effects.length) effects.push(setup)},
  }
  const config = resolveConfig({}, {})
  let failNext = false
  runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023}}).outputText, {
    exports, require: (name: string) => {assert.equal(name, 'react'); return react}, AbortSignal,
    fetch: async (url: string, options: any) => {requests.push({url, options}); if (failNext) {failNext = false; throw new Error('SECRET transport detail')} return {ok: true, status: 200, json: async () => ({config: options.body ? {...config, ...JSON.parse(options.body)} : config, runs: []})}},
  })
  const registrations: {options: any; component: (...args: any[]) => Node}[] = []; const disposers: (() => void)[] = []
  exports.apply({slots: {inject(_name: string, setup: () => () => void) {disposers.push(setup())}, register(options: any, component: any) {registrations.push({options, component}); return () => undefined}}})
  return {exports, config, registrations, requests, effects, failRequest() {failNext = true}, render() {cursor = 0; return registrations[0]!.component()}}
}
function nodes(tree: unknown): Node[] {
  if (!tree || typeof tree !== 'object' || !('children' in tree)) return []
  const node = tree as Node
  return [node, ...node.children.flatMap(nodes)]
}
const text = (node: Node): string => node.children.map(child => typeof child === 'string' ? child : child && typeof child === 'object' && 'children' in child ? text(child as Node) : '').join(' ')

test('classic CommonJS entry loads with host React and exact slot registrations', () => {
  const client = loadClient()
  assert.equal(client.exports.name, 'dsh-qoder-link-client')
  assert.deepEqual(client.registrations.map(item => item.options.name), ['settings.section', 'plugins.bundle.config', 'plugins.row.config'])
  assert.equal(client.registrations[0]!.options.id, 'qoder-link')
  assert.equal(client.registrations[1]!.options.key, 'dsh-qoder-link')
  assert.equal(client.registrations[2]!.options.key, 'dsh-qoder-link#qoder-link')
  assert.equal(client.registrations[1]!.component({view: 'summary'}), null)
  assert.ok(!source.includes('·'))
  assert.ok(!source.includes('/auth/'))
  assert.deepEqual([...new Set([...source.matchAll(/fontSize: '(\d+)px'/g)].map(match => Number(match[1])))].sort((a, b) => a - b), [13, 14, 18])
  assert.ok(source.includes('0.5px solid'))
})
test('config validation covers variants, paths, model/default, effort and numeric limits', () => {
  const {exports, config} = loadClient()
  assert.equal(exports.validateConfig(config), '')
  for (const patch of [{cliVariant: 'other'}, {qodercliBin: 5}, {models: []}, {defaultModel: 'missing'}, {hiddenModels: ['default']}, {reasoningEffort: 'max'}, {permissionMode: 'dontAsk'}, {timeoutMs: 0}, {maxConcurrency: 17}, {stallWarnMs: -1}, {queueTimeoutMs: NaN}, {modelContext: {default: 0}}, {workspaceRoot: 'relative'}]) {
    assert.ok(exports.validateConfig({...config, ...patch}), JSON.stringify(patch))
  }
  assert.equal(exports.validateConfig({...config, cliVariant: 'qoderclicn', stallWarnMs: 0}), '')
  assert.match(exports.loginInstructions('qodercli'), /运行 qodercli 并/)
  assert.match(exports.loginInstructions('qoderclicn'), /运行 qoderclicn 并/)
  assert.match(exports.loginInstructions('qoderclicn'), /不验证登录状态/)
  assert.throws(() => exports.parseStatus({config: {}, runs: []}), /状态格式无效/)
})
test('UI loading, editable fields, variant login copy, validation and save lifecycle', async () => {
  const client = loadClient()
  assert.match(text(client.render()), /正在加载状态/)
  const cleanup = client.effects[0]!()
  await new Promise(resolve => setImmediate(resolve))
  let tree = client.render()
  assert.match(text(tree), /模型提供方调用始终禁用 CLI 内置工具/)
  assert.match(text(tree), /DSH 文件沙箱之外/)
  assert.equal(client.requests[0]!.options.credentials, 'same-origin')
  const variant = nodes(tree).find(node => node.type === 'select' && node.props.value === 'qodercli')!
  variant.props.onChange({target: {value: 'qoderclicn'}})
  tree = client.render(); assert.match(text(tree), /运行 qoderclicn 并/)
  const timeout = nodes(tree).find(node => node.type === 'label' && text(node).startsWith('调用超时'))!
  const input = nodes(timeout).find(node => node.type === 'input')!
  input.props.onChange({target: {value: ''}})
  tree = client.render()
  assert.equal(nodes(tree).find(node => node.type === 'button' && text(node) === '保存设置')!.props.disabled, true)
  input.props.onChange({target: {value: '5000'}})
  tree = client.render()
  nodes(tree).find(node => node.type === 'button' && text(node) === '保存设置')!.props.onClick()
  assert.match(text(client.render()), /正在保存设置/)
  await new Promise(resolve => setImmediate(resolve))
  assert.match(text(client.render()), /设置已保存/)
  const save = client.requests[1]!
  assert.equal(save.url, '/plugins/qoder-link/config')
  assert.equal(save.options.method, 'POST')
  assert.equal(JSON.parse(save.options.body).cliVariant, 'qoderclicn')
  assert.equal(JSON.parse(save.options.body).timeoutMs, 5000)
  cleanup?.()
})
test('failed loading shows safe retry state and successful retry recovers', async () => {
  const client = loadClient()
  client.failRequest(); client.render(); const cleanup = client.effects[0]!()
  await new Promise(resolve => setImmediate(resolve))
  const failed = client.render()
  assert.match(text(failed), /请求失败或超时/)
  assert.ok(!text(failed).includes('SECRET'))
  const retry = nodes(failed).find(node => node.type === 'button' && text(node) === '重试加载')!
  assert.equal(retry.props.disabled, false); retry.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.match(text(client.render()), /共享模型列表/)
  cleanup?.()
})
