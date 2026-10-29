// Classic-script entry: the DSH loader supplies its own React instance.
// Do not import server modules or a second copy of React here.
type ReactApi = {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
  useState<T>(initial: T): [T, (next: T | ((previous: T) => T)) => void]
  useEffect(setup: () => void | (() => void), dependencies: unknown[]): void
  useRef<T>(initial: T): {current: T}
}
const {createElement, useState, useEffect, useRef} = require('react') as ReactApi
export const name = 'dsh-qoder-link-client'
export const inject = ['slots']
export interface ClientContext {
  slots: {
    inject(name: string, register: () => () => void): void
    register(options: {name: string; id?: string; key?: string; order?: number; label?: string}, component: (props?: unknown) => unknown): () => void
  }
}
interface Config {
  enabled: boolean; cliVariant: 'qodercli' | 'qoderclicn'; qodercliBin: string; qoderclicnBin: string
  models: string[]; hiddenModels: string[]; defaultModel: string; tools: string
  permissionMode: 'dont_ask' | 'default' | 'accept_edits'; reasoningEffort: string
  timeoutMs: number; contextWindow: number; maxPromptChars: number; workspaceRoot: string
  maxConcurrency: number; queueTimeoutMs: number; stallWarnMs: number; askTool: boolean; modelContext: Record<string, number>
}
interface Run {id: string; state: string; requestedModel: string; requestedEffort: string; queuedAt: number; warning: boolean; accountName?: string; failure?: string; lastProgressAt?: number}
interface Account {id: string; name: string; cliVariant: Config['cliVariant']; enabled: boolean; authState: 'unverified'; createdAt: string; active: number}
interface Accounts {managed: boolean; cliVariant: Config['cliVariant']; mode: 'fixed' | 'pool'; selectedAccountId?: string; accounts: Account[]; patSupport: 'supported' | 'unknown'}
interface Status {config: Config; runs: Run[]; accounts?: Accounts}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const efforts = ['auto', 'low', 'medium', 'high']
const modes = ['dont_ask', 'default', 'accept_edits']
const modelId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.exec(value)?.[0] === value && !value.includes(':/') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..')
const integer = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
export function validateConfig(value: unknown): string {
  if (!record(value)) return '设置格式无效'
  if (typeof value.enabled !== 'boolean' || typeof value.askTool !== 'boolean' || !['qodercli', 'qoderclicn'].includes(String(value.cliVariant))) return '请选择有效的 CLI 版本'
  if (!['qodercliBin', 'qoderclicnBin', 'workspaceRoot', 'tools'].every(key => typeof value[key] === 'string')) return 'CLI 路径和工具配置必须是文本'
  if (String(value.workspaceRoot).trim() && !/^(?:[a-zA-Z]:[\\/]|\/|\\\\)/.test(String(value.workspaceRoot).trim())) return '工作目录必须是绝对路径'
  if (!Array.isArray(value.models) || !value.models.length || !value.models.every(modelId) || !Array.isArray(value.hiddenModels) || !value.hiddenModels.every(modelId)) return '模型列表不能为空，模型 ID 只能包含字母、数字和 . _ : / -'
  if (!modelId(value.defaultModel) || !value.models.includes(value.defaultModel) || value.hiddenModels.includes(value.defaultModel)) return '默认模型必须在列表中且未被隐藏'
  if (!modes.includes(String(value.permissionMode)) || !efforts.includes(String(value.reasoningEffort))) return '请选择有效的权限模式与推理强度'
  if (!integer(value.maxConcurrency, 1, 16) || !integer(value.timeoutMs, 1, 2147483647) || !integer(value.queueTimeoutMs, 1, 2147483647) || !integer(value.stallWarnMs, 0, 2147483647)) return '并发数须为 1 至 16；时间须为有效整数，无进展提醒可设为 0'
  if (!integer(value.contextWindow, 1) || !integer(value.maxPromptChars, 1)) return '上下文预算与提示词长度必须是正整数'
  if (!record(value.modelContext) || !Object.entries(value.modelContext).every(([id, size]) => modelId(id) && integer(size, 1))) return '模型上下文映射须为模型 ID 到正整数的 JSON 对象'
  return ''
}
export function parseAccounts(value: unknown): Accounts {
  if (!record(value) || typeof value.managed !== 'boolean' || !['qodercli', 'qoderclicn'].includes(String(value.cliVariant)) || !['fixed', 'pool'].includes(String(value.mode)) || !['supported', 'unknown'].includes(String(value.patSupport)) || !Array.isArray(value.accounts) || (value.selectedAccountId !== undefined && typeof value.selectedAccountId !== 'string')) throw new Error('服务端账户格式无效')
  const accounts = value.accounts.map(item => {
    if (!record(item) || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || item.cliVariant !== value.cliVariant || typeof item.enabled !== 'boolean' || item.authState !== 'unverified' || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt)) || !integer(item.active, 0)) throw new Error('服务端账户格式无效')
    return {id: item.id, name: item.name.slice(0, 100), cliVariant: item.cliVariant as Config['cliVariant'], enabled: item.enabled, authState: 'unverified' as const, createdAt: item.createdAt, active: item.active}
  })
  return {managed: value.managed, cliVariant: value.cliVariant as Config['cliVariant'], mode: value.mode as Accounts['mode'], selectedAccountId: value.selectedAccountId as string | undefined, accounts, patSupport: value.patSupport as Accounts['patSupport']}
}
export function parseStatus(value: unknown): Status {
  if (!record(value) || validateConfig(value.config) || !Array.isArray(value.runs)) throw new Error('服务端状态格式无效')
  const runs: Run[] = []
  for (const run of value.runs) {
    if (!record(run) || typeof run.id !== 'string' || !['queued', 'starting', 'waiting', 'responding', 'completed', 'failed', 'cancelled'].includes(String(run.state)) || !integer(run.queuedAt, 0)) continue
    runs.push({id: run.id, state: String(run.state), requestedModel: modelId(run.requestedModel) ? run.requestedModel : 'unknown', requestedEffort: efforts.includes(String(run.requestedEffort)) ? String(run.requestedEffort) : 'auto', queuedAt: run.queuedAt, warning: run.warning === true,
      accountName: typeof run.accountName === 'string' ? run.accountName.slice(0, 100) : undefined,
      failure: ['timeout', 'queue-timeout', 'aborted', 'error'].includes(String(run.failure)) ? String(run.failure) : undefined,
      lastProgressAt: integer(run.lastProgressAt, 0) ? run.lastProgressAt : undefined})
  }
  // Whitelist config keys: never retain an unexpected credential in the browser draft.
  const c = value.config as unknown as Config
  const config: Config = {enabled:c.enabled, cliVariant:c.cliVariant, qodercliBin:c.qodercliBin, qoderclicnBin:c.qoderclicnBin, models:c.models, hiddenModels:c.hiddenModels, defaultModel:c.defaultModel, tools:c.tools, permissionMode:c.permissionMode, reasoningEffort:c.reasoningEffort, timeoutMs:c.timeoutMs, contextWindow:c.contextWindow, maxPromptChars:c.maxPromptChars, workspaceRoot:c.workspaceRoot, maxConcurrency:c.maxConcurrency, queueTimeoutMs:c.queueTimeoutMs, stallWarnMs:c.stallWarnMs, askTool:c.askTool, modelContext:c.modelContext}
  const accounts = value.accounts === undefined ? undefined : parseAccounts(value.accounts)
  if (accounts && accounts.cliVariant !== config.cliVariant) throw new Error('服务端账户格式无效')
  return {config, accounts, runs: runs.sort((a, b) => b.queuedAt - a.queuedAt).slice(0, 5)}
}
type AccountAction = 'accounts/add' | 'accounts/update' | 'accounts/remove' | 'accounts/config'
async function request(action: 'status' | 'config' | AccountAction, body?: unknown): Promise<Status | Accounts> {
  let response: Response
  try {
    response = await fetch(`/plugins/qoder-link/${action}`, {method: action === 'status' ? 'GET' : 'POST', credentials: 'same-origin', mode: 'same-origin', signal: AbortSignal.timeout(20000),
      ...(body ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {})})
  } catch { throw new Error('请求失败或超时，请检查连接后重试。') }
  if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}），请检查设置后重试。`)
  try { const value: unknown = await response.json(); return action.startsWith('accounts/') ? parseAccounts(value) : parseStatus(value) } catch { throw new Error('服务端状态格式无效，请重试。') }
}
const border = '0.5px solid var(--dsw-alias-border-l2, var(--gray-6))'
const secondary = 'var(--dsw-alias-label-secondary, var(--gray-11))'
const accent = 'var(--dsw-alias-state-business-primary, var(--accent-9))'
const control = {font: 'inherit', fontSize: '13px', minHeight: '30px', boxSizing: 'border-box', border, borderRadius: '6px', padding: '4px 9px', color: 'var(--dsw-alias-label-primary, var(--gray-12))', background: 'var(--dsw-alias-bg-layer-1, var(--gray-2))'}
const field = {display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0, marginBottom: '12px'}
const box = {padding: '14px', border, borderRadius: '8px', marginBottom: '14px'}
const row = {display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap'}
const grid = {display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '12px'}
const selectedStyle = {borderColor: accent, color: accent, background: 'var(--accent-3)'}
function h(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown {
  const styles: Record<string, object> = {
    input: props?.type === 'checkbox' ? {width: '16px', height: '16px', accentColor: 'var(--accent-9)', marginRight: '8px'} : {...control, width: '100%'},
    select: {...control, width: '100%'}, textarea: {...control, width: '100%', minHeight: '80px'},
    button: {...control, cursor: props?.disabled ? 'not-allowed' : 'pointer', opacity: props?.disabled ? 0.5 : 1},
    h2: {fontSize: '16px', margin: '0 0 12px', fontWeight: 600}, h3: {fontSize: '14px', margin: '0 0 12px', fontWeight: 600},
    p: {margin: '10px 0', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary, var(--gray-11))'},
  }
  return createElement(type, {...props, style: {...(typeof type === 'string' ? styles[type] : {}), ...(props?.role === 'alert' ? {color: 'var(--red-11)'} : {}), ...(props?.style as object ?? {})}}, ...children)
}
export function loginInstructions(variant: Config['cliVariant']): string {
  return `在运行 DSH 的同一台机器、同一系统账户下打开终端，运行 ${variant} 并按 CLI 自身的提示完成登录。若配置了自定义路径，请运行对应的可执行文件。本地登录状态不在此页面验证，也不会导入 CLI 已有凭据。托管 PAT 账户请在上方单独添加。`
}
function SettingsPanel(): unknown {
  const [status, setStatus] = useState<Status | null>(null)
  const [draft, setDraft] = useState<Config | null>(null)
  const [busy, setBusy] = useState<'load' | 'save' | 'account' | ''>('load')
  const [editor, setEditor] = useState<{kind: 'add' | 'replace' | 'rename'; id?: string; cliVariant: Config['cliVariant']} | null>(null)
  const [accountName, setAccountName] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const password = useRef<{value: string} | null>(null)
  const sequence = useRef(0)
  const polling = useRef<Promise<void> | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [modelText, setModelText] = useState('')
  const [hiddenText, setHiddenText] = useState('')
  const [contextText, setContextText] = useState('{}')
  const live = useRef(false)
  const pending = useRef(false)
  const load = async (save = false) => {
    if (!live.current || pending.current || (save && (!draft || validateConfig(draft)))) return
    pending.current = true; const ticket = ++sequence.current
    setBusy(save ? 'save' : 'load'); setError(''); setMessage('')
    try {
      if (polling.current) await polling.current
      if (!live.current || ticket !== sequence.current) return
      const result = await request(save ? 'config' : 'status', save && draft ? draft : undefined) as Status
      if (!live.current || ticket !== sequence.current) return
      setStatus(result)
      if (save) {closeEditor(); setRemoving(null)}
      if (save || !draft) {
        setDraft(result.config); setModelText(result.config.models.join('\n')); setHiddenText(result.config.hiddenModels.join('\n')); setContextText(JSON.stringify(result.config.modelContext, null, 2))
      }
      setMessage(save ? '设置已保存。后续调用使用新设置，正在运行的调用不受影响。' : '状态已刷新；未保存的修改已保留。')
    } catch (cause) { if (live.current && ticket === sequence.current) setError(cause instanceof Error ? cause.message : '请求失败，请重试。') }
    finally { if (ticket === sequence.current) {pending.current = false; if (live.current) setBusy('')} }
  }
  function closeEditor(): void {if (password.current) password.current.value = ''; setEditor(null); setAccountName('')}
  async function manage(action: AccountAction, body: Record<string, unknown>): Promise<void> {
    if (!live.current || pending.current) return
    pending.current = true; const ticket = ++sequence.current
    setBusy('account'); setError(''); setMessage('')
    try {
      if (polling.current) await polling.current
      if (!live.current || ticket !== sequence.current) return
      const accounts = await request(action, body) as Accounts
      if (!live.current || ticket !== sequence.current) return
      setStatus(previous => previous && previous.config.cliVariant === accounts.cliVariant ? {...previous, accounts} : previous)
      closeEditor(); setRemoving(null); setMessage('账户已更新。PAT 未经过远端验证。')
    } catch (cause) {if (live.current && ticket === sequence.current) setError(cause instanceof Error ? cause.message : '账户操作失败，请重试。')}
    finally {if (ticket === sequence.current) {pending.current = false; if (live.current) setBusy('')}}
  }
  function submitAccount(): void {
    if (!editor || pending.current || !live.current || !status) return
    if (editor.cliVariant !== status.config.cliVariant) {closeEditor(); setError('账户区域已变化，请重新打开账户操作。'); return}
    if (editor.kind === 'rename') {if (accountName.trim()) void manage('accounts/update', {id: editor.id, name: accountName.trim()}); return}
    const token = password.current?.value.trim() ?? ''
    if (password.current) password.current.value = ''
    if (!token) {setError('请输入 PAT。'); return}
    void manage(editor.kind === 'add' ? 'accounts/add' : 'accounts/update', editor.kind === 'add'
      ? {cliVariant: status.config.cliVariant, name: accountName.trim(), token} : {id: editor.id, token})
  }
  function poll(): void {
    if (!live.current || pending.current || polling.current) return
    const ticket = ++sequence.current
    const work = request('status').then(result => {
      if (live.current && ticket === sequence.current) setStatus(result as Status)
    }).catch(() => { /* Do not replace explicit operation errors with background failures. */ }).finally(() => {if (polling.current === work) polling.current = null})
    polling.current = work
  }
  useEffect(() => {
    live.current = true; void load()
    const timer = setInterval(poll, 2000)
    return () => {clearInterval(timer); live.current = false; ++sequence.current; pending.current = false; polling.current = null; if (password.current) password.current.value = ''}
  }, [])
  const update = (patch: Partial<Config>) => { setDraft(previous => previous ? {...previous, ...patch} : previous); setMessage('') }
  const valueChange = (key: keyof Config) => (event: {target: {value: string}}) => update({[key]: event.target.value})
  const textField = (key: 'qodercliBin' | 'qoderclicnBin' | 'workspaceRoot' | 'tools', label: string, placeholder = '') => h('label', {style: field}, label, h('input', {value: draft?.[key] ?? '', placeholder, onChange: valueChange(key)}))
  const select = (key: 'cliVariant' | 'defaultModel' | 'permissionMode' | 'reasoningEffort', label: string, values: string[]) => h('label', {style: field}, label, h('select', {value: draft?.[key], onChange: valueChange(key)}, ...values.map(value => h('option', {key: value, value}, value))))
  const split = (value: string) => [...new Set(value.split(/[\n,]/).map(item => item.trim()).filter(Boolean))]
  let contextError = ''
  try { const parsed: unknown = JSON.parse(contextText); if (!record(parsed) || !Object.entries(parsed).every(([id, size]) => modelId(id) && integer(size, 1))) contextError = '模型上下文映射须为模型 ID 到正整数的 JSON 对象' } catch { contextError = '模型上下文映射不是有效 JSON' }
  const validation = draft ? validateConfig(draft) || contextError : ''
  const accounts = status?.accounts
  const locked = !!busy
  const accountLocked = locked || !accounts
  const currentVariant = status?.config.cliVariant ?? 'qodercli'
  const eligible = accounts?.accounts.find(item => item.enabled)
  function openEditor(kind: 'add' | 'replace' | 'rename', account?: Account): void {
    if (password.current) password.current.value = ''
    setEditor({kind, id: account?.id, cliVariant: currentVariant}); setAccountName(kind === 'rename' ? account?.name ?? '' : ''); setRemoving(null); setError('')
  }
  return h('section', {style: {fontSize: '13px', lineHeight: 1.5, color: 'var(--dsw-alias-label-primary, var(--gray-12))', maxWidth: '800px', width: '100%', boxSizing: 'border-box', padding: '16px'}, 'aria-label': 'Qoder 设置', 'aria-busy': !!busy},
    h('div', {style: {...row, justifyContent: 'space-between', marginBottom: '12px'}}, h('h2', {style: {margin: 0}}, 'Qoder'),
      h('span', {style: {fontSize: '12px', color: secondary}}, `原生 ACP / stdio${status ? status.config.enabled ? '，已启用' : '，未启用' : ''}`)),
    h('p', null, '通过本机 Qoder CLI 接入 DSH。国际版与中国版隔离账户和路径，共用模型与运行设置。'),
    error ? h('p', {role: 'alert'}, error) : null,
    busy ? h('p', {role: 'status', 'aria-live': 'polite'}, busy === 'save' ? '正在保存设置…' : busy === 'account' ? '正在更新账户…' : '正在加载状态…') : null,
    message ? h('p', {role: 'status'}, message) : null,
    !status && error ? h('button', {type: 'button', disabled: locked, onClick: () => void load()}, '重试加载') : null,
    h('section', {style: box, 'aria-label': '账户列表'},
      h('div', {style: {...row, justifyContent: 'space-between', marginBottom: '10px'}}, h('h3', {style: {margin: 0}}, '账户'), h('div', {style: row},
        h('button', {type: 'button', disabled: locked || !status, onClick: () => void load()}, '刷新状态'),
        h('button', {type: 'button', disabled: accountLocked, onClick: () => openEditor('add')}, '添加账户'))),
      h('p', {style: {fontSize: '12px'}}, `当前账户区域：${currentVariant === 'qodercli' ? '国际版' : '中国版'}。两个区域的 PAT 不互通，切换版本不会迁移账户或回退到另一区域。`),
      draft && draft.cliVariant !== currentVariant ? h('p', {role: 'status'}, 'CLI 版本尚未保存，账户操作仍作用于当前已保存的区域。') : null,
      accounts?.patSupport === 'unknown' ? h('p', {role: 'alert'}, '当前版本的 PAT 支持尚未确认，托管账户不能执行。') : null,
      h('div', {role: 'group', 'aria-label': '账户使用方式', style: {...row, marginBottom: '10px'}},
        h('button', {type: 'button', 'aria-pressed': accounts?.mode === 'fixed', disabled: accountLocked || !eligible, style: accounts?.mode === 'fixed' ? selectedStyle : {},
          onClick: () => void manage('accounts/config', {cliVariant: currentVariant, mode: 'fixed', accountId: accounts?.accounts.find(item => item.id === accounts.selectedAccountId && item.enabled)?.id ?? eligible?.id})}, '固定账户'),
        h('button', {type: 'button', 'aria-pressed': accounts?.mode === 'pool', disabled: accountLocked, style: accounts?.mode === 'pool' ? selectedStyle : {},
          onClick: () => void manage('accounts/config', {cliVariant: currentVariant, mode: 'pool'})}, '账户池')),
      ...(accounts?.accounts ?? []).map(account => h('article', {key: account.id, 'aria-label': `账户 ${account.name}`, style: {borderTop: border, padding: '10px 0'}},
        h('div', {style: {...row, justifyContent: 'space-between'}},
          h('div', {style: row}, h('strong', {style: {overflowWrap: 'anywhere'}}, account.name),
            h('span', {style: {fontSize: '12px', color: secondary}}, account.enabled ? '已启用，PAT 未验证' : '已停用'),
            accounts!.mode === 'fixed' && accounts!.selectedAccountId === account.id ? h('span', {style: {fontSize: '12px', color: accent}}, '当前') : null,
            account.active ? h('span', {style: {fontSize: '12px', color: secondary}}, `运行中 ${account.active}`) : null),
          h('div', {style: row},
            h('button', {type: 'button', disabled: accountLocked || !account.enabled || (accounts!.mode === 'fixed' && accounts!.selectedAccountId === account.id), onClick: () => void manage('accounts/config', {cliVariant: currentVariant, mode: 'fixed', accountId: account.id})}, '使用'),
            h('button', {type: 'button', disabled: accountLocked, onClick: () => openEditor('rename', account)}, '重命名'),
            h('button', {type: 'button', disabled: accountLocked, onClick: () => void manage('accounts/update', {id: account.id, enabled: !account.enabled})}, account.enabled ? '停用' : '启用'),
            h('button', {type: 'button', disabled: accountLocked, onClick: () => openEditor('replace', account)}, '替换 PAT'),
            h('button', {type: 'button', disabled: accountLocked, onClick: () => {closeEditor(); setRemoving(account.id)}}, '删除'))),
        removing === account.id ? h('div', {role: 'group', 'aria-label': '确认删除账户', style: {...row, marginTop: '8px'}},
          h('span', null, '删除此账户及其已保存的 PAT？'),
          h('button', {type: 'button', disabled: accountLocked, onClick: () => void manage('accounts/remove', {id: account.id})}, '确认删除'),
          h('button', {type: 'button', disabled: accountLocked, onClick: () => setRemoving(null)}, '保留账户')) : null)),
      !accounts?.accounts.length ? h('p', null, accounts?.managed ? '暂无托管账户，不会回退到 CLI 本地登录。请添加账户。' : accounts ? '暂无托管账户，当前沿用 CLI 本地登录。' : '账户管理尚不可用，请刷新状态或升级服务端。') : null,
      h('p', {style: {fontSize: '12px'}}, '固定账户仅使用所选账户；账户池在当前区域的已启用账户间调度。保存 PAT 不代表认证成功，不查询积分或模型目录。'),
      editor && editor.cliVariant === currentVariant ? h('div', {key: `${currentVariant}-${editor.kind}-${editor.id ?? ''}`, role: 'group', 'aria-label': editor.kind === 'add' ? '添加 PAT 账户' : editor.kind === 'replace' ? '替换账户 PAT' : '重命名账户', style: {borderTop: border, paddingTop: '12px'}},
        editor.kind !== 'replace' ? h('label', {style: field}, '账户名称', h('input', {value: accountName, maxLength: 100, disabled: accountLocked, autoComplete: 'off', onChange: (event: {target: {value: string}}) => setAccountName(event.target.value)})) : null,
        editor.kind !== 'rename' ? h('label', {style: field}, '个人访问令牌（PAT）', h('input', {type: 'password', ref: password, disabled: accountLocked, autoComplete: 'new-password', spellCheck: false, autoCapitalize: 'none', 'aria-label': '个人访问令牌（PAT）'})) : null,
        editor.kind !== 'rename' ? h('p', {style: {fontSize: '12px'}}, '仅发送至当前 DSH 服务端保存，不回显已有 PAT，不写入浏览器存储。提交后立即清空输入。',
          h('a', {href: currentVariant === 'qodercli' ? 'https://qoder.com/account/integrations' : 'https://qoder.cn/account/integrations', target: '_blank', rel: 'noopener noreferrer', style: {color: accent, marginLeft: '8px'}}, '获取 PAT')) : null,
        h('div', {style: row}, h('button', {type: 'button', disabled: accountLocked || (editor.kind !== 'replace' && !accountName.trim()), onClick: submitAccount}, editor.kind === 'rename' ? '保存名称' : '保存 PAT'),
          h('button', {type: 'button', disabled: accountLocked, onClick: closeEditor}, '取消'))) : null),
    draft ? h('fieldset', {disabled: !!busy, style: {border: 0, padding: 0, margin: '16px 0', minWidth: 0}},
      h('section', {style: box}, h('h3', null, 'CLI 与登录'),
        h('label', {style: field}, h('span', null, h('input', {type: 'checkbox', checked: draft.enabled, onChange: (event: {target: {checked: boolean}}) => update({enabled: event.target.checked})}), '启用 Qoder Link')),
        select('cliVariant', '使用的 CLI 版本', ['qodercli', 'qoderclicn']),
        h('div', {style: grid}, textField('qodercliBin', 'qodercli 可执行文件路径', '留空使用 PATH 中的 qodercli'),
          textField('qoderclicnBin', 'qoderclicn 可执行文件路径', '留空使用 PATH 中的 qoderclicn')),
        h('p', null, loginInstructions(draft.cliVariant)), h('p', null, '切换版本不会迁移登录，也不会回退到另一个 CLI。路径仅填写可执行文件，不要附加命令参数。')),
      h('section', {style: box}, h('h3', null, '模型与运行'),
        h('label', {style: field}, '共享模型列表（每行一个 ID）', h('textarea', {value: modelText, onChange: (event: {target: {value: string}}) => {setModelText(event.target.value); update({models: split(event.target.value)})}})),
        h('div', {style: grid}, select('defaultModel', '默认模型', draft.models.filter(id => !draft.hiddenModels.includes(id))),
          select('reasoningEffort', '推理强度', efforts)), h('p', null, 'auto 不发送推理强度参数。其他值只是请求，不代表服务端已确认支持。模型 ID 的可用性由当前 CLI 与服务端决定。'),
        h('p', {style: {fontSize: '12px'}}, '无进展超时不是总时长上限。有效文本、思考、工具状态变化和匹配的 ACP 初始化响应会续期；无进展提醒仅提示，不会中止调用。'),
        h('div', {style: grid}, ...([['timeoutMs', '无进展超时（毫秒）', 1, 2147483647], ['maxConcurrency', '最大并发数', 1, 16], ['queueTimeoutMs', '排队超时（毫秒）', 1, 2147483647], ['stallWarnMs', '无进展提醒（毫秒，0 关闭）', 0, 2147483647]] as const).map(([key, label, min, max]) => h('label', {key, style: field}, label, h('input', {type: 'number', min, max, step: 1, value: Number.isNaN(draft[key]) ? '' : draft[key], onChange: (event: {target: {value: string}}) => update({[key]: event.target.value.trim() ? Number(event.target.value) : NaN})}))))),
      h('section', {style: box}, h('h3', null, '工具与安全边界'),
        h('p', {role: 'note'}, '模型提供方调用始终禁用 CLI 内置工具。独立 ask 工具默认不启用 CLI 内置工具；只有显式填写 tools 才会启用，启用后在 DSH 文件沙箱之外执行，可访问 CLI 系统账户有权访问的资源。'),
        h('label', {style: field}, h('span', null, h('input', {type: 'checkbox', checked: draft.askTool, onChange: (event: {target: {checked: boolean}}) => update({askTool: event.target.checked})}), '注册独立 ask 工具')),
        textField('tools', '独立 ask 调用允许的 CLI 工具', '默认留空，不启用 CLI 内置工具'),
        select('permissionMode', '独立 ask 调用权限模式', modes), h('p', null, '权限模式不是 DSH 沙箱。default 模式可能需要交互确认；无人值守调用请谨慎配置。')),
      h('details', {style: box}, h('summary', {style: {cursor: 'pointer'}}, '高级设置'),
        textField('workspaceRoot', 'CLI 工作目录（绝对路径，可留空）'),
        h('label', {style: field}, '隐藏的共享模型（每行一个 ID）', h('textarea', {value: hiddenText, onChange: (event: {target: {value: string}}) => {setHiddenText(event.target.value); update({hiddenModels: split(event.target.value)})}})),
        ...([['contextWindow', 'DSH 回退上下文预算'], ['maxPromptChars', '最大提示词字符数']] as const).map(([key, label]) => h('label', {key, style: field}, label, h('input', {type: 'number', min: 1, step: 1, value: Number.isNaN(draft[key]) ? '' : draft[key], onChange: (event: {target: {value: string}}) => update({[key]: event.target.value.trim() ? Number(event.target.value) : NaN})}))),
        h('label', {style: field}, '每模型上下文预算（JSON）', h('textarea', {value: contextText, onChange: (event: {target: {value: string}}) => {setContextText(event.target.value); setMessage(''); try {update({modelContext: JSON.parse(event.target.value)})} catch { /* keep text for validation */ }}})),
        h('p', null, '上下文预算仅用于 DSH 元数据，不会覆盖 CLI 上下文限制。')),
      validation ? h('p', {role: 'alert'}, validation) : null,
      h('button', {type: 'button', disabled: !!busy || !!validation, onClick: () => void load(true)}, '保存设置')) : null,
    h('details', {style: box, 'aria-label': '运行记录'}, h('summary', {style: {cursor: 'pointer', fontWeight: 600}}, `运行记录（${status?.runs.length ?? 0}）`), h('p', {style: {fontSize: '12px'}}, '当前进程内最近 5 条，每 2 秒刷新。不展示提示词、原始输出或错误详情。'),
      ...(status?.runs.length ? status.runs.map(run => h('article', {key: run.id, style: {borderTop: border, padding: '8px 0', overflowWrap: 'anywhere'}},
        h('p', null, `${({queued: '排队中', starting: '启动中', waiting: '等待响应', responding: '响应中', completed: '已完成', failed: '失败', cancelled: '已取消'} as Record<string, string>)[run.state]}；模型：${run.requestedModel}；推理强度请求：${run.requestedEffort}（未确认）`),
        run.accountName ? h('p', null, `账户：${run.accountName}`) : null,
        run.lastProgressAt !== undefined ? h('p', null, `最近进展：${new Date(run.lastProgressAt).toLocaleTimeString()}`) : null,
        run.failure ? h('p', null, ({timeout: '无进展超时', 'queue-timeout': '排队超时', aborted: '已中止', error: '执行失败'} as Record<string, string>)[run.failure]) : null,
        run.warning ? h('p', {role: 'status'}, '长时间无进展，仍在等待；这不代表失败。') : null)) : [h('p', {key: 'empty'}, '暂无运行记录')]))
  )
}
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({name: 'settings.section', id: 'qoder-link', order: 20, label: 'Qoder Link'}, SettingsPanel))
  const panel = (props?: unknown) => record(props) && props.view === 'summary' ? null : h(SettingsPanel)
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({name: 'plugins.bundle.config', key: 'dsh-qoder-link'}, panel))
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({name: 'plugins.row.config', key: 'dsh-qoder-link#qoder-link'}, panel))
}
