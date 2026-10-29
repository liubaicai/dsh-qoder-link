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
    useState(initial: unknown) {const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (next: any) => {writes++; state[index] = typeof next === 'function' ? next(state[index]) : next}]},
    useRef(initial: unknown) {const index = cursor++; if (!(index in state)) state[index] = {current: initial}; return state[index]},
    useEffect(setup: () => void | (() => void)) {if (!effects.length) effects.push(setup)},
  }
  const config = resolveConfig({}, {})
  let failNext = false
  let accounts = {managed: true, cliVariant: 'qodercli', mode: 'fixed', selectedAccountId: 'a1', patSupport: 'supported', accounts: [{id: 'a1', name: '工作账户', cliVariant: 'qodercli', enabled: true, authState: 'unverified', createdAt: '2026-01-01T00:00:00Z', active: 0}]}
  let handler: ((url: string, options: any) => Promise<any>) | undefined
  const timers: (() => void)[] = []
  let writes = 0
  runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023}}).outputText, {
    exports, require: (name: string) => {assert.equal(name, 'react'); return react}, AbortSignal,
    setInterval: (callback: () => void) => {timers.push(callback); return timers.length}, clearInterval: () => undefined,
    fetch: async (url: string, options: any) => {
      requests.push({url, options})
      if (failNext) {failNext = false; throw new Error('SECRET transport detail')}
      if (handler) return handler(url, options)
      const body = options.body ? JSON.parse(options.body) : {}
      if (url.includes('/accounts/')) {
        if (url.endsWith('/add')) accounts.accounts.push({id: 'a2', name: body.name, cliVariant: body.cliVariant, enabled: true, authState: 'unverified', createdAt: '2026-01-01T00:00:00Z', active: 0})
        if (url.endsWith('/update')) accounts.accounts = accounts.accounts.map(item => item.id === body.id ? {...item, ...(body.name ? {name: body.name} : {}), ...(typeof body.enabled === 'boolean' ? {enabled: body.enabled} : {})} : item)
        if (url.endsWith('/remove')) accounts.accounts = accounts.accounts.filter(item => item.id !== body.id)
        if (url.endsWith('/config')) accounts = {...accounts, mode: body.mode, selectedAccountId: body.accountId ?? accounts.selectedAccountId}
        return {ok: true, status: 200, json: async () => accounts}
      }
      if (url.endsWith('/config')) {Object.assign(config, body); accounts = {...accounts, cliVariant: config.cliVariant, accounts: accounts.accounts.filter(item => item.cliVariant === config.cliVariant)}}
      return {ok: true, status: 200, json: async () => ({config, runs: [], accounts})}
    },
  })
  const registrations: {options: any; component: (...args: any[]) => Node}[] = []; const disposers: (() => void)[] = []
  exports.apply({slots: {inject(_name: string, setup: () => () => void) {disposers.push(setup())}, register(options: any, component: any) {registrations.push({options, component}); return () => undefined}}})
  return {exports, config, registrations, requests, effects, timers, accounts, writes: () => writes,
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
const reply = (value: unknown) => ({ok: true, status: 200, json: async () => value})

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
  assert.deepEqual([...new Set([...source.matchAll(/fontSize: '(\d+)px'/g)].map(match => Number(match[1])))].sort((a, b) => a - b), [12, 13, 14, 16])
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
  assert.match(exports.loginInstructions('qoderclicn'), /本地登录状态不在此页面验证/)
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
  const timeout = nodes(tree).find(node => node.type === 'label' && text(node).startsWith('无进展超时'))!
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
test('PAT add, replace, rename, enable, pool selection and deletion use the account contract', async () => {
  const client = loadClient(); client.render(); const cleanup = client.effects[0]!(); await flush()
  let tree = client.render()
  assert.match(text(tree), /原生 ACP/); assert.match(text(tree), /PAT 未验证/)
  assert.match(text(tree), /不是总时长上限/)
  button(tree, '添加账户').props.onClick(); tree = client.render()
  inputFor(tree, '账户名称').props.onChange({target: {value: '个人账户'}}); tree = client.render()
  const pat = inputFor(tree, '个人访问令牌')
  assert.equal(pat.props.type, 'password'); assert.equal(pat.props.value, undefined)
  assert.equal(pat.props.autoComplete, 'new-password')
  pat.props.ref.current = {value: 'test-pat-only'}
  const submit = button(tree, '保存 PAT').props.onClick
  submit(); submit()
  assert.equal(pat.props.ref.current.value, '')
  await flush(); tree = client.render()
  assert.equal(client.requests.filter(item => item.url.endsWith('/accounts/add')).length, 1)
  assert.deepEqual(JSON.parse(client.requests.at(-1)!.options.body), {cliVariant: 'qodercli', name: '个人账户', token: 'test-pat-only'})
  assert.ok(!text(tree).includes('test-pat-only')); assert.match(text(tree), /个人账户/)
  button(tree, '替换 PAT').props.onClick(); tree = client.render()
  inputFor(tree, '个人访问令牌').props.ref.current = {value: 'replacement-pat'}
  button(tree, '保存 PAT').props.onClick(); await flush()
  assert.deepEqual(JSON.parse(client.requests.at(-1)!.options.body), {id: 'a1', token: 'replacement-pat'})
  tree = client.render(); button(tree, '重命名').props.onClick(); tree = client.render()
  inputFor(tree, '账户名称').props.onChange({target: {value: '新名称'}}); tree = client.render()
  button(tree, '保存名称').props.onClick(); await flush()
  assert.deepEqual(JSON.parse(client.requests.at(-1)!.options.body), {id: 'a1', name: '新名称'})
  tree = client.render(); button(tree, '停用').props.onClick(); await flush()
  assert.deepEqual(JSON.parse(client.requests.at(-1)!.options.body), {id: 'a1', enabled: false})
  tree = client.render(); button(tree, '启用').props.onClick(); await flush()
  assert.deepEqual(JSON.parse(client.requests.at(-1)!.options.body), {id: 'a1', enabled: true})
  tree = client.render(); button(tree, '账户池').props.onClick(); await flush()
  assert.deepEqual(JSON.parse(client.requests.at(-1)!.options.body), {cliVariant: 'qodercli', mode: 'pool'})
  tree = client.render(); button(tree, '使用').props.onClick(); await flush()
  assert.deepEqual(JSON.parse(client.requests.at(-1)!.options.body), {cliVariant: 'qodercli', mode: 'fixed', accountId: 'a1'})
  tree = client.render(); const count = client.requests.length
  button(tree, '删除').props.onClick(); tree = client.render()
  assert.equal(client.requests.length, count); assert.ok(button(tree, '确认删除'))
  button(tree, '保留账户').props.onClick(); tree = client.render(); assert.equal(client.requests.length, count)
  button(tree, '删除').props.onClick(); tree = client.render(); button(tree, '确认删除').props.onClick(); await flush()
  assert.equal(client.requests.at(-1)!.url, '/plugins/qoder-link/accounts/remove')
  cleanup?.()
})

test('account parsing strips credentials and rejects mismatched regions and malformed snapshots', () => {
  const client = loadClient()
  const parsed = client.exports.parseStatus({config: {...client.config, token: 'never-retain'}, accounts: {...client.accounts, token: 'never-retain', accounts: client.accounts.accounts.map(item => ({...item, token: 'never-retain'}))}, runs: []})
  assert.ok(!JSON.stringify(parsed).includes('never-retain'))
  for (const patch of [{mode: 'random'}, {patSupport: 'yes'}, {managed: 'yes'}, {accounts: [{...client.accounts.accounts[0], cliVariant: 'qoderclicn'}]}, {accounts: [{...client.accounts.accounts[0], authState: 'verified'}]}]) assert.throws(() => client.exports.parseAccounts({...client.accounts, ...patch}))
  assert.throws(() => client.exports.parseStatus({config: {...client.config, cliVariant: 'qoderclicn'}, accounts: client.accounts, runs: []}))
  assert.ok(!source.includes('localStorage')); assert.ok(!source.includes('sessionStorage'))
})

test('unsaved variant and model draft remain separate from account actions and status polling', async () => {
  const client = loadClient(); client.render(); const cleanup = client.effects[0]!(); await flush()
  let tree = client.render()
  nodes(tree).find(node => node.type === 'select' && node.props.value === 'qodercli')!.props.onChange({target: {value: 'qoderclicn'}})
  tree = client.render(); assert.match(text(tree), /尚未保存/)
  button(tree, '账户池').props.onClick(); await flush()
  assert.equal(JSON.parse(client.requests.at(-1)!.options.body).cliVariant, 'qodercli')
  client.timers[0]!(); await flush(); tree = client.render()
  assert.ok(nodes(tree).some(node => node.type === 'select' && node.props.value === 'qoderclicn'))
  button(tree, '添加账户').props.onClick(); tree = client.render()
  assert.ok(nodes(tree).some(node => node.type === 'a' && node.props.href === 'https://qoder.com/account/integrations'))
  const pat = inputFor(tree, '个人访问令牌'); pat.props.ref.current = {value: 'cancel-secret'}
  button(tree, '取消').props.onClick(); assert.equal(pat.props.ref.current.value, '')
  cleanup?.()
})

test('polling response cannot overwrite an explicit account operation, and unmount blocks writes', async () => {
  const client = loadClient(); client.render(); const cleanup = client.effects[0]!(); await flush()
  let resolvePoll!: (value: any) => void
  client.respondWith(async url => url.endsWith('/status') ? new Promise(resolve => {resolvePoll = resolve}) : reply({...client.accounts, mode: 'pool'}))
  client.timers[0]!()
  button(client.render(), '账户池').props.onClick()
  assert.equal(client.requests.at(-1)!.url, '/plugins/qoder-link/status')
  resolvePoll(reply({config: client.config, runs: [], accounts: {...client.accounts, accounts: [{...client.accounts.accounts[0], name: '过时名称'}]}}))
  await flush(); const tree = client.render()
  assert.ok(!text(tree).includes('过时名称')); assert.equal(button(tree, '账户池').props['aria-pressed'], true)
  let resolveLate!: (value: any) => void
  client.respondWith(async () => new Promise(resolve => {resolveLate = resolve}))
  button(tree, '刷新状态').props.onClick(); cleanup?.()
  const count = client.writes(); resolveLate(reply({config: client.config, runs: [], accounts: client.accounts})); await flush()
  assert.equal(client.writes(), count)
})

test('failed PAT submission clears password and never displays raw transport data', async () => {
  const client = loadClient(); client.render(); const cleanup = client.effects[0]!(); await flush()
  button(client.render(), '替换 PAT').props.onClick(); let tree = client.render()
  const pat = inputFor(tree, '个人访问令牌'); pat.props.ref.current = {value: 'secret-failed'}
  client.failRequest(); button(tree, '保存 PAT').props.onClick(); await flush(); tree = client.render()
  assert.equal(pat.props.ref.current.value, ''); assert.ok(!text(tree).includes('SECRET')); assert.ok(!text(tree).includes('secret-failed'))
  assert.match(text(tree), /请求失败或超时/); cleanup?.()
})

test('settings recovery shows fixed help, rejects malformed flags and blocks stale save handlers', async () => {
  const client=loadClient()
  assert.equal(client.exports.parseStatus({config:client.config,runs:[]}).settingsError,false)
  assert.equal(client.exports.parseStatus({config:client.config,runs:[],settingsError:''}).settingsError,false)
  for(const settingsError of [true,{},42,null]) assert.throws(()=>client.exports.parseStatus({config:client.config,runs:[],settingsError}))
  client.render();const cleanup=client.effects[0]!();await flush()
  const staleSave=button(client.render(),'保存设置').props.onClick
  client.respondWith(async()=>reply({config:{...client.config,enabled:false,askTool:false},runs:[],settingsError:'SECRET parser detail'}))
  client.timers[0]!();await flush()
  // Invoke the pre-recovery handler before React commits the new status.
  const count=client.requests.length;staleSave();await flush();assert.equal(client.requests.length,count)
  const tree=client.render()
  assert.match(text(tree),/配置无法加载/);assert.match(text(tree),/原文件未修改/)
  assert.doesNotMatch(text(tree),/SECRET parser detail/)
  assert.equal(button(tree,'保存设置').props.disabled,true)
  button(tree,'保存设置').props.onClick();await flush();assert.equal(client.requests.length,count)
  cleanup?.()
})

test('status accepts only exact account-store repair diagnostic and never raw error text', async () => {
  for(const error of ['Cannot access Qoder account store; repair the store before continuing','SECRET raw error','Cannot access Qoder account store; repair the store before continuing SECRET']) {
    const client=loadClient()
    client.respondWith(async()=>({ok:false,status:500,json:async()=>({error})}))
    client.render();const cleanup=client.effects[0]!();await flush()
    const rendered=text(client.render());assert.doesNotMatch(rendered,/SECRET/)
    if(error==='Cannot access Qoder account store; repair the store before continuing') assert.match(rendered,/修复账户存储.*不会回退本机登录/)
    else assert.match(rendered,/HTTP 500/)
    cleanup?.()
  }
  const client=loadClient();client.render();const cleanup=client.effects[0]!();await flush()
  client.respondWith(async()=>({ok:false,status:400,json:async()=>({error:'Cannot access Qoder account store; repair the store before continuing'})}))
  button(client.render(),'保存设置').props.onClick();await flush()
  assert.match(text(client.render()),/HTTP 400/);assert.doesNotMatch(text(client.render()),/不会回退本机登录/)
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
