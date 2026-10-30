import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {resolveConfig} from '../src/config.ts'

const source = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
type Node = {type: unknown; props: Record<string, any>; children: unknown[]}
const reply = (value: unknown) => ({ok: true, status: 200, json: async () => value})
function loadClient() {
  const exports: Record<string, any> = {}
  const state: unknown[] = []; const effects: (() => void | (() => void))[] = []; const requests: {url: string; options: any}[] = []
  let cursor = 0; let writes = 0
  const react = {
    createElement: (type: unknown, props: Record<string, any>, ...children: unknown[]) => ({type, props, children}),
    useState(initial: unknown) {const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (next: any) => {writes++; state[index] = typeof next === 'function' ? next(state[index]) : next}]},
    useRef(initial: unknown) {const index = cursor++; if (!(index in state)) state[index] = {current: initial}; return state[index]},
    useEffect(setup: () => void | (() => void)) {if (!effects.length) effects.push(setup)},
  }
  const config = resolveConfig({}, {})
  let failNext = false
  let handler: ((url: string, options: any) => Promise<any>) | undefined
  const timers: (() => void)[] = []
  let catalogModels = [{id: 'default', name: '默认模型'}, {id: 'fast', name: '快速模型'}]
  const snapshot = (extra: Record<string, unknown> = {}) => ({config: {...config}, runs: [], catalogModels, modelMessage: '已获取当前 CLI 模型列表。', ...extra})
  runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023}}).outputText, {
    exports, require: (name: string) => {assert.equal(name, 'react'); return react}, AbortSignal,
    setInterval: (callback: () => void) => {timers.push(callback); return timers.length}, clearInterval: () => undefined,
    fetch: async (url: string, options: any) => {
      requests.push({url, options})
      if (failNext) {failNext = false; throw new Error('SECRET transport detail')}
      if (handler) return handler(url, options)
      if (url.endsWith('/config')) {Object.assign(config, JSON.parse(options.body)); catalogModels = [{id: 'default', name: config.cliVariant === 'qodercli' ? '默认模型' : '中国模型'}, {id: 'fast', name: '快速模型'}]}
      return reply(snapshot())
    },
  })
  const registrations: {options: any; component: (...args: any[]) => Node}[] = []
  exports.apply({slots: {inject(_name: string, setup: () => () => void) {setup()}, register(options: any, component: any) {registrations.push({options, component}); return () => undefined}}})
  return {exports, config, registrations, requests, effects, timers, snapshot, writes: () => writes,
    respondWith(next: typeof handler) {handler = next}, failRequest() {failNext = true}, render() {cursor = 0; return registrations[0]!.component()}}
}
function nodes(tree: unknown): Node[] {
  if (!tree || typeof tree !== 'object' || !('children' in tree)) return []
  const node = tree as Node
  return [node, ...node.children.flatMap(nodes)]
}
const text = (node: Node): string => node.children.map(child => typeof child === 'string' ? child : child && typeof child === 'object' && 'children' in child ? text(child as Node) : '').join(' ')
const flush = () => new Promise(resolve => setImmediate(resolve))
const button = (tree: Node, label: string) => nodes(tree).find(node => node.type === 'button' && text(node) === label)!
const inputFor = (tree: Node, label: string) => nodes(nodes(tree).find(node => node.type === 'label' && text(node).startsWith(label))!).find(node => node.type === 'input')!
const selectFor = (tree: Node, label: string) => nodes(nodes(tree).find(node => node.type === 'label' && text(node).startsWith(label))!).find(node => node.type === 'select')!

test('classic CommonJS entry loads host React and exact slots with compact semantic styling', () => {
  const client = loadClient()
  assert.equal(client.exports.name, 'dsh-qoder-link-client')
  assert.deepEqual(client.registrations.map(item => item.options.name), ['settings.section', 'plugins.bundle.config', 'plugins.row.config'])
  assert.equal(client.registrations[0]!.options.id, 'qoder-link')
  assert.equal(client.registrations[1]!.options.key, 'dsh-qoder-link')
  assert.equal(client.registrations[2]!.options.key, 'dsh-qoder-link#qoder-link')
  assert.equal(client.registrations[1]!.component({view: 'summary'}), null)
  assert.ok(!source.includes('·'))
  for (const removed of ['accounts/', 'parseAccounts', 'loginInstructions', '个人访问令牌', '/auth/', 'localStorage', 'sessionStorage', 'dangerouslySkipPermissions']) assert.ok(!source.includes(removed), removed)
  assert.deepEqual([...new Set([...source.matchAll(/fontSize: '(\d+)px'/g)].map(match => Number(match[1])))].sort((a, b) => a - b), [12, 13, 14, 16])
  assert.ok(source.includes('0.5px solid'))
})
test('config validation preserves variants, paths, model/default, effort and numeric limits', () => {
  const {exports, config} = loadClient()
  assert.equal(exports.validateConfig(config), '')
  for (const patch of [{cliVariant: 'other'}, {qodercliBin: 5}, {models: []}, {defaultModel: 'missing'}, {hiddenModels: ['default']}, {reasoningEffort: 'max'}, {permissionMode: 'dontAsk'}, {timeoutMs: 0}, {maxConcurrency: 17}, {stallWarnMs: -1}, {queueTimeoutMs: NaN}, {modelContext: {default: 0}}, {workspaceRoot: 'relative'}]) assert.ok(exports.validateConfig({...config, ...patch}), JSON.stringify(patch))
  assert.equal(exports.validateConfig({...config, cliVariant: 'qoderclicn', stallWarnMs: 0}), '')
  assert.throws(() => exports.parseStatus({config: {}, runs: []}), /状态格式无效/)
})
test('initial status loads models once and compact UI has one region selector and accessible safety help', async () => {
  const client = loadClient(); assert.match(text(client.render()), /正在加载状态/)
  const cleanup = client.effects[0]!(); await flush(); let tree = client.render()
  assert.deepEqual(client.requests.map(item => item.url), ['/plugins/qoder-link/status', '/plugins/qoder-link/models'])
  assert.equal(client.requests[1]!.options.body, '{}'); assert.equal(client.requests[1]!.options.method, 'POST'); assert.equal(client.requests[1]!.options.credentials, 'same-origin')
  assert.equal(nodes(tree).filter(node => node.type === 'select' && node.props.value === 'qodercli').length, 1)
  assert.equal(nodes(tree).filter(node => node.type === 'select' && node.props['aria-label'] === 'CLI区域').length, 1)
  assert.doesNotMatch(text(tree), /使用的 CLI|启用 Qoder|原生 ACP|stdio|已启用|未启用|按提示登录|本地登录态|注册独立 ask|CLI 工作目录|最大并发数|每模型上下文预算|添加账户|\bPAT\b/)
  assert.equal(nodes(tree).filter(node => node.type === 'input').length, 2)
  assert.ok(!nodes(tree).some(node => node.type === 'textarea' || node.props.type === 'checkbox' || node.props.type === 'number'))
  assert.ok(!source.includes('contextText')); assert.ok(!source.includes('contextInvalid'))
  assert.ok(nodes(tree).some(node => node.type === 'fieldset' && text(node).includes('模型与独立委派设置')))
  assert.equal(nodes(tree).filter(node => node.type === 'details').length, 2)
  assert.ok(nodes(tree).filter(node => node.type === 'details').every(node => !node.props.open))
  const help = nodes(tree).find(node => node.props['aria-label'] === '模型与独立委派安全说明')!
  help.props.onFocus(); tree = client.render()
  const tooltip = nodes(tree).find(node => node.props.role === 'tooltip')!
  assert.match(text(tooltip), /模型提供方调用始终禁用 CLI 内置工具/); assert.match(text(tooltip), /DSH 文件沙箱之外/)
  assert.equal(nodes(tree).find(node => node.props['aria-label'] === '模型与独立委派安全说明')!.props['aria-describedby'], tooltip.props.id)
  help.props.onKeyDown({key: 'Escape'}); assert.ok(!nodes(client.render()).some(node => node.props.role === 'tooltip'))
  cleanup?.()
})
test('pill enable/default selection saves while preserving all advanced fields and avoids redundant discovery', async () => {
  const client = loadClient(); client.render(); const cleanup = client.effects[0]!(); await flush()
  let tree = client.render(); assert.equal(button(tree, '快速模型').props['aria-pressed'], false)
  tree = client.render(); button(tree, '快速模型').props.onClick(); tree = client.render()
  assert.equal(button(tree, '快速模型').props['aria-pressed'], true)
  selectFor(tree, '默认模型').props.onChange({target: {value: 'fast'}})
  tree = client.render()
  button(tree, '保存设置').props.onClick(); assert.match(text(client.render()), /正在保存设置/); await flush()
  const saved = JSON.parse(client.requests.at(-1)!.options.body)
  assert.equal(saved.defaultModel, 'fast'); assert.equal(saved.timeoutMs, client.config.timeoutMs); assert.equal(saved.enabled, true)
  for (const key of Object.keys(client.config)) assert.ok(key in saved, key)
  assert.equal(client.requests.filter(item => item.url.endsWith('/models')).length, 1)
  assert.match(text(client.render()), /设置已保存/); cleanup?.()
})
test('hidden settings survive saves unchanged and explicit disabled state is not overridden', async () => {
  assert.equal(resolveConfig({}, {}).enabled, true)
  const client = loadClient()
  const hidden = {enabled: false, askTool: false, workspaceRoot: 'C:\\workspace', tools: 'Read', timeoutMs: 4321, maxConcurrency: 7, queueTimeoutMs: 9876, stallWarnMs: 0, contextWindow: 12000, maxPromptChars: 22000, modelContext: {default: 24000}}
  Object.assign(client.config, hidden)
  client.render(); const cleanup = client.effects[0]!(); await flush()
  let tree = client.render(); selectFor(tree, '默认推理强度').props.onChange({target: {value: 'high'}})
  tree = client.render(); button(tree, '保存设置').props.onClick(); await flush()
  const saved = JSON.parse(client.requests.at(-1)!.options.body)
  for (const [key, value] of Object.entries(hidden)) assert.deepEqual(saved[key], value, key)
  assert.equal(saved.reasoningEffort, 'high'); assert.equal(saved.enabled, false)
  cleanup?.()
})
test('dirty region and path hide old models, block captured refresh handlers, and save refreshes new region', async () => {
  const client = loadClient(); client.render(); const cleanup = client.effects[0]!(); await flush()
  let tree = client.render(); const staleRefresh = button(tree, '获取模型列表').props.onClick
  nodes(tree).find(node => node.props['aria-label'] === 'CLI区域')!.props.onChange({target: {value: 'qoderclicn'}})
  const count = client.requests.length; staleRefresh(); await flush(); assert.equal(client.requests.length, count)
  tree = client.render(); assert.match(text(tree), /尚未保存/); assert.equal(nodes(tree).find(node => node.props['aria-label'] === 'CLI区域')!.props.value, 'qoderclicn')
  assert.equal(button(tree, '获取模型列表').props.disabled, true); assert.equal(button(tree, '默认模型'), undefined)
  assert.equal(selectFor(tree, '默认模型').props.disabled, true)
  button(tree, '保存设置').props.onClick(); await flush(); tree = client.render()
  assert.equal(client.requests.at(-2)!.url, '/plugins/qoder-link/config'); assert.equal(client.requests.at(-1)!.url, '/plugins/qoder-link/models')
  assert.ok(button(tree, '中国模型')); assert.equal(button(tree, '获取模型列表').props.disabled, false)
  inputFor(tree, '中国版 CLI 路径').props.onChange({target: {value: 'C:\\bin\\qoderclicn.exe'}}); tree = client.render()
  assert.equal(button(tree, '获取模型列表').props.disabled, true); button(tree, '保存设置').props.onClick(); await flush()
  assert.equal(client.requests.at(-1)!.url, '/plugins/qoder-link/models'); cleanup?.()
})
test('refresh and polling preserve unsaved model and reasoning draft edits', async () => {
  const client = loadClient(); client.render(); const cleanup = client.effects[0]!(); await flush()
  let tree = client.render(); button(tree, '快速模型').props.onClick(); tree = client.render()
  selectFor(tree, '默认推理强度').props.onChange({target: {value: 'high'}})
  button(client.render(), '获取模型列表').props.onClick(); await flush(); client.timers[0]!(); await flush(); tree = client.render()
  assert.equal(button(tree, '快速模型').props['aria-pressed'], true); assert.equal(selectFor(tree, '默认推理强度').props.value, 'high')
  cleanup?.()
})
test('status parsing bounds labels and whitelists model messages, settings diagnostics and config fields', () => {
  const client = loadClient()
  const parsed = client.exports.parseStatus(client.snapshot({config: {...client.config, token: 'SECRET'}, modelMessage: 'SECRET upstream text', settingsError: 'SECRET parser detail'}))
  assert.ok(!JSON.stringify(parsed).includes('SECRET')); assert.equal(parsed.modelMessage, '模型列表尚未加载。')
  for (const name of ['x'.repeat(129), 'bad\nlabel', '\u202esecret', '']) assert.throws(() => client.exports.parseStatus(client.snapshot({catalogModels: [{id: 'fast', name}]})))
  for (const id of ['../secret', 'a:/b', 'bad\nid']) assert.throws(() => client.exports.parseStatus(client.snapshot({catalogModels: [{id, name: 'safe'}]})))
  for (const modelMessage of ['已获取当前 CLI 模型列表。', '模型列表获取失败，请检查 CLI 安装、登录与网络后重试。', '模型列表尚未加载。']) assert.equal(client.exports.parseStatus(client.snapshot({modelMessage})).modelMessage, modelMessage)
})
test('poll response cannot overwrite explicit discovery and unmount blocks writes and follow-up requests', async () => {
  const client = loadClient(); client.render(); const cleanup = client.effects[0]!(); await flush()
  let resolvePoll!: (value: any) => void
  client.respondWith(async url => url.endsWith('/status') ? new Promise(resolve => {resolvePoll = resolve}) : reply(client.snapshot({catalogModels: [{id: 'new', name: '新模型'}]})))
  client.timers[0]!(); button(client.render(), '获取模型列表').props.onClick()
  assert.equal(client.requests.at(-1)!.url, '/plugins/qoder-link/status')
  resolvePoll(reply(client.snapshot({catalogModels: [{id: 'old', name: '过时模型'}]}))); await flush()
  assert.doesNotMatch(text(client.render()), /过时模型/); assert.ok(button(client.render(), '新模型'))
  let resolveLate!: (value: any) => void
  client.respondWith(async () => new Promise(resolve => {resolveLate = resolve}))
  button(client.render(), '获取模型列表').props.onClick(); cleanup?.(); const writes = client.writes()
  resolveLate(reply(client.snapshot())); await flush(); assert.equal(client.writes(), writes)
  const initial = loadClient(); let resolveInitial!: (value: any) => void
  initial.respondWith(async () => new Promise(resolve => {resolveInitial = resolve})); initial.render(); const stop = initial.effects[0]!(); stop?.()
  resolveInitial(reply(initial.snapshot())); await flush(); assert.equal(initial.requests.length, 1)
})
test('settings recovery shows fixed help, rejects malformed flags and blocks stale save handlers', async () => {
  const client = loadClient()
  assert.equal(client.exports.parseStatus({config: client.config, runs: []}).settingsError, false)
  for (const settingsError of [true, {}, 42, null]) assert.throws(() => client.exports.parseStatus(client.snapshot({settingsError})))
  client.render(); const cleanup = client.effects[0]!(); await flush()
  const staleSave = button(client.render(), '保存设置').props.onClick
  client.respondWith(async () => reply(client.snapshot({settingsError: 'SECRET parser detail'}))); client.timers[0]!(); await flush()
  const count = client.requests.length; staleSave(); await flush(); assert.equal(client.requests.length, count)
  const tree = client.render(); assert.match(text(tree), /配置无法加载/); assert.match(text(tree), /原文件未修改/); assert.doesNotMatch(text(tree), /SECRET/)
  assert.equal(button(tree, '保存设置').props.disabled, true); assert.equal(button(tree, '获取模型列表').props.disabled, true); cleanup?.()
})
test('failed loading shows safe retry and discovery failure can be retried without raw errors', async () => {
  const client = loadClient(); client.failRequest(); client.render(); const cleanup = client.effects[0]!(); await flush()
  let tree = client.render(); assert.match(text(tree), /请求失败或超时/); assert.doesNotMatch(text(tree), /SECRET/)
  button(tree, '重试加载').props.onClick(); await flush(); tree = client.render(); assert.ok(button(tree, '快速模型'))
  client.respondWith(async () => ({ok: false, status: 409, json: async () => ({error: 'SECRET'})}))
  button(tree, '获取模型列表').props.onClick(); await flush(); tree = client.render()
  assert.match(text(tree), /HTTP 409/); assert.doesNotMatch(text(tree), /SECRET/); assert.equal(button(tree, '获取模型列表').props.disabled, false)
  client.respondWith(undefined); button(tree, '获取模型列表').props.onClick(); await flush(); assert.doesNotMatch(text(client.render()), /HTTP 409/)
  cleanup?.()
})
