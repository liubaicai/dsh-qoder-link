// Classic-script entry: DSH supplies its own React instance. No server imports.
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
interface Run {id: string; state: string; requestedModel: string; requestedEffort: string; queuedAt: number; warning: boolean; failure?: string; lastProgressAt?: number}
interface Status {settingsError: boolean; config: Config; runs: Run[]; catalogModels: {id: string; name: string}[]; modelMessage: string}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const efforts = ['auto', 'low', 'medium', 'high']
const modes = ['dont_ask', 'default', 'accept_edits']
const modelId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.exec(value)?.[0] === value && !value.includes(':/') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..')
const integer = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
const modelMessages = ['已获取当前 CLI 模型列表。', '模型列表获取失败，请检查 CLI 安装、登录与网络后重试。', '模型列表尚未加载。']
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
export function parseStatus(value: unknown): Status {
  if (!record(value) || (value.settingsError !== undefined && typeof value.settingsError !== 'string') || validateConfig(value.config) || !Array.isArray(value.runs)) throw new Error('服务端状态格式无效')
  const catalog = value.catalogModels ?? []
  if (!Array.isArray(catalog) || catalog.length > 1000 || !catalog.every(item => record(item) && modelId(item.id) && typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 128 && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(item.name))) throw new Error('服务端状态格式无效')
  const runs: Run[] = []
  for (const run of value.runs) {
    if (!record(run) || typeof run.id !== 'string' || !['queued', 'starting', 'waiting', 'responding', 'completed', 'failed', 'cancelled'].includes(String(run.state)) || !integer(run.queuedAt, 0)) continue
    runs.push({id: run.id, state: String(run.state), requestedModel: modelId(run.requestedModel) ? run.requestedModel : 'unknown', requestedEffort: efforts.includes(String(run.requestedEffort)) ? String(run.requestedEffort) : 'auto', queuedAt: run.queuedAt, warning: run.warning === true,
      failure: ['timeout', 'queue-timeout', 'aborted', 'error'].includes(String(run.failure)) ? String(run.failure) : undefined,
      lastProgressAt: integer(run.lastProgressAt, 0) ? run.lastProgressAt : undefined})
  }
  const c = value.config as unknown as Config
  const config: Config = {enabled:c.enabled, cliVariant:c.cliVariant, qodercliBin:c.qodercliBin, qoderclicnBin:c.qoderclicnBin, models:c.models, hiddenModels:c.hiddenModels, defaultModel:c.defaultModel, tools:c.tools, permissionMode:c.permissionMode, reasoningEffort:c.reasoningEffort, timeoutMs:c.timeoutMs, contextWindow:c.contextWindow, maxPromptChars:c.maxPromptChars, workspaceRoot:c.workspaceRoot, maxConcurrency:c.maxConcurrency, queueTimeoutMs:c.queueTimeoutMs, stallWarnMs:c.stallWarnMs, askTool:c.askTool, modelContext:c.modelContext}
  return {settingsError: typeof value.settingsError === 'string' && value.settingsError.length > 0, config, runs: runs.sort((a, b) => b.queuedAt - a.queuedAt).slice(0, 5),
    catalogModels: catalog.map(item => ({id: item.id as string, name: item.name as string})), modelMessage: modelMessages.includes(String(value.modelMessage)) ? String(value.modelMessage) : modelMessages[2]!}
}
async function request(action: 'status' | 'config' | 'models', body?: unknown): Promise<Status> {
  let response: Response
  try { response = await fetch(`/plugins/qoder-link/${action}`, {method: action === 'status' ? 'GET' : 'POST', credentials: 'same-origin', mode: 'same-origin', signal: AbortSignal.timeout(20000),
    ...(body === undefined ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})}) }
  catch { throw new Error('请求失败或超时，请检查连接后重试。') }
  if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}），请检查设置后重试。`)
  try { return parseStatus(await response.json()) } catch { throw new Error('服务端状态格式无效，请重试。') }
}
const border = '0.5px solid var(--dsw-alias-border-l2, var(--gray-6))'
const foreground = 'var(--dsw-alias-label-primary, var(--gray-12))'
const secondary = 'var(--dsw-alias-label-secondary, var(--gray-11))'
const accent = 'var(--dsw-alias-state-business-primary, var(--accent-9))'
const control = {font: 'inherit', fontSize: '13px', minHeight: '30px', boxSizing: 'border-box', border, borderRadius: '6px', padding: '4px 9px', color: foreground, background: 'var(--dsw-alias-bg-layer-1, var(--gray-2))'}
const field = {display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0}
const box = {padding: '14px', border, borderRadius: '8px', marginBottom: '14px', minWidth: 0}
const row = {display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap'}
const grid = {display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: '12px', marginBottom: '12px'}
const selectedStyle = {borderColor: accent, color: accent, background: 'var(--accent-3)'}
function h(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown {
  const styles: Record<string, object> = {
    input: props?.type === 'checkbox' ? {width: '16px', height: '16px', accentColor: accent, marginRight: '8px'} : {...control, width: '100%'},
    select: {...control, width: '100%'}, textarea: {...control, width: '100%', minHeight: '64px'},
    button: {...control, fontWeight: 500, cursor: props?.disabled ? 'not-allowed' : 'pointer', opacity: props?.disabled ? 0.5 : 1},
    h2: {fontSize: '16px', margin: 0, fontWeight: 600}, h3: {fontSize: '14px', margin: 0, fontWeight: 600},
    legend: {fontSize: '14px', fontWeight: 600, padding: '0 6px'},
    p: {margin: '8px 0', lineHeight: 1.6, color: secondary},
  }
  return createElement(type, {...props, style: {...(typeof type === 'string' ? styles[type] : {}), ...(props?.role === 'alert' ? {color: 'var(--red-11)'} : {}), ...(props?.style as object ?? {})}}, ...children)
}
const cliKey = (c: Config): string => JSON.stringify([c.cliVariant, c.qodercliBin, c.qoderclicnBin, c.workspaceRoot])
const safety = '模型提供方调用始终禁用 CLI 内置工具。独立委派仅在显式配置 tools 后启用 CLI 工具，在 DSH 文件沙箱之外执行，可访问系统账户有权访问的资源。权限模式不是 DSH 沙箱，default 可能要求交互确认。仅在信任当前工作区时启用。'
function SettingsPanel(): unknown {
  const [status, storeStatus] = useState<Status | null>(null)
  const [draft, storeDraft] = useState<Config | null>(null)
  const draftRef = useRef<Config | null>(null)
  const statusRef = useRef<Status | null>(null)
  const setStatus = (result: Status) => {statusRef.current = result; storeStatus(result)}
  const setDraft = (config: Config) => {draftRef.current = config; storeDraft(config)}
  const [busy, setBusy] = useState('正在加载状态')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [contextText, setContextText] = useState('{}')
  const contextInvalid = useRef(false)
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const helpId = useRef(`qoder-safety-${Math.random().toString(36).slice(2)}`)
  const live = useRef(false)
  const pending = useRef(false)
  const sequence = useRef(0)
  const polling = useRef<Promise<void> | null>(null)
  const dirtyCli = () => !!draftRef.current && !!statusRef.current && cliKey(draftRef.current) !== cliKey(statusRef.current.config)
  async function load(action: 'initial' | 'status' | 'config' | 'models'): Promise<void> {
    if (!live.current || pending.current || (action === 'config' && (statusRef.current?.settingsError || contextInvalid.current || !draftRef.current || validateConfig(draftRef.current))) || (action === 'models' && (dirtyCli() || statusRef.current?.settingsError))) return
    pending.current = true; const ticket = ++sequence.current
    const current = () => live.current && ticket === sequence.current
    setBusy(action === 'config' ? '正在保存设置' : action === 'models' ? '正在获取模型' : '正在加载状态'); setError(''); setNotice('')
    try {
      if (polling.current) await polling.current
      if (!current()) return
      if (action === 'config' && statusRef.current?.settingsError) return
      if (action === 'models' && dirtyCli()) return
      const previousKey = statusRef.current ? cliKey(statusRef.current.config) : ''
      const result = await request(action === 'initial' ? 'status' : action, action === 'config' ? draftRef.current : action === 'models' ? {} : undefined)
      if (!current()) return
      setStatus(result)
      if (action === 'config' || !draftRef.current) {setDraft(result.config); contextInvalid.current = false; setContextText(JSON.stringify(result.config.modelContext, null, 2))}
      if (action === 'config') setNotice('设置已保存。后续调用使用新设置。')
      if (!result.settingsError && (action === 'initial' || (action === 'config' && previousKey !== cliKey(result.config)))) {
        setBusy('正在获取模型')
        const models = await request('models', {})
        if (!current()) return
        setStatus(models)
      }
    } catch (cause) {if (current()) setError(cause instanceof Error ? cause.message : '请求失败，请重试。')}
    finally {if (ticket === sequence.current) {pending.current = false; if (live.current) setBusy('')}}
  }
  function poll(): void {
    if (!live.current || pending.current || polling.current) return
    const ticket = ++sequence.current
    const work = request('status').then(result => {if (live.current && ticket === sequence.current) setStatus(result)})
      .catch(() => {}).finally(() => {if (polling.current === work) polling.current = null})
    polling.current = work
  }
  useEffect(() => {live.current = true; void load('initial'); const timer = setInterval(poll, 2000)
    return () => {clearInterval(timer); live.current = false; ++sequence.current; pending.current = false; polling.current = null}
  }, [])
  const update = (patch: Partial<Config>) => {if (draftRef.current) setDraft({...draftRef.current, ...patch}); setNotice('')}
  const valueChange = (key: keyof Config) => (event: {target: {value: string}}) => update({[key]: event.target.value})
  const textField = (key: 'qodercliBin' | 'qoderclicnBin' | 'workspaceRoot' | 'tools', label: string) => h('label', {style: field}, label, h('input', {value: draft?.[key] ?? '', onChange: valueChange(key)}))
  const select = (key: 'defaultModel' | 'permissionMode' | 'reasoningEffort', label: string, values: string[], labels?: Map<string, string>) => h('label', {style: field}, label,
    h('select', {value: draft?.[key], disabled: key === 'defaultModel' && dirtyCli(), onChange: valueChange(key)},
      !values.includes(draft?.[key] ?? '') ? h('option', {value: draft?.[key] ?? '', disabled: true}, '请选择有效值') : null,
      ...values.map(value => h('option', {key: value, value}, labels?.get(value) ?? value))))
  let contextError = ''
  try {const parsed: unknown = JSON.parse(contextText); if (!record(parsed) || !Object.entries(parsed).every(([id, size]) => modelId(id) && integer(size, 1))) contextError = '模型上下文映射须为模型 ID 到正整数的 JSON 对象'} catch {contextError = '模型上下文映射不是有效 JSON'}
  const validation = draft ? validateConfig(draft) || contextError : ''
  const changedCli = dirtyCli()
  const locked = !!busy
  const models = new Map<string, string>()
  if (!changedCli) {
    for (const model of status?.catalogModels ?? []) models.set(model.id, model.name)
    for (const id of [...(draft?.models ?? []), ...(draft?.hiddenModels ?? [])]) if (!models.has(id)) models.set(id, id)
  }
  const enabled = [...models.keys()].filter(id => draft?.models.includes(id) && !draft.hiddenModels.includes(id))
  const tooltip = !dismissed && (hover || focus)
  return h('section', {'aria-label': 'Qoder 设置', 'aria-busy': locked, style: {maxWidth: '800px', width: '100%', boxSizing: 'border-box', padding: '16px', fontSize: '13px', lineHeight: 1.5, color: foreground}},
    h('div', {style: {...row, justifyContent: 'space-between', marginBottom: '12px'}}, h('h2', null, 'Qoder'), h('span', {style: {fontSize: '12px', color: secondary}}, `原生 ACP / stdio${status ? status.config.enabled ? '，已启用' : '，未启用' : ''}`)),
    h('div', {role: 'status', 'aria-live': 'polite', style: {color: secondary}}, busy ? `${busy}…` : notice),
    status?.settingsError ? h('p', {role: 'alert'}, 'Qoder 配置无法加载，模型调用与独立委派已停用。请修复插件 settings.json 或管理员配置后重启 DSH；原文件未修改，无法保存覆盖。') : null,
    error ? h('p', {role: 'alert'}, error, !status ? h('button', {type: 'button', disabled: locked, onClick: () => void load('initial')}, '重试加载') : null) : null,
    draft ? h('div', null,
      h('fieldset', {disabled: locked, style: box}, h('legend', null, 'CLI 区域'),
        h('div', {style: {...row, justifyContent: 'space-between'}}, h('label', {style: {...field, flex: '1 1 180px'}}, '使用的 CLI',
          h('select', {value: draft.cliVariant, onChange: valueChange('cliVariant')}, h('option', {value: 'qodercli'}, '国际版'), h('option', {value: 'qoderclicn'}, '中国版'))),
          h('label', null, h('input', {type: 'checkbox', checked: draft.enabled, onChange: (event: {target: {checked: boolean}}) => update({enabled: event.target.checked})}), '启用 Qoder')),
        h('p', {style: {fontSize: '12px'}}, `在 DSH 所在机器、同一系统账户的终端运行 ${draft.cliVariant} 并按提示登录。自定义路径请运行对应文件。此页面不验证登录状态，不导入凭据。`),
        h('p', {style: {fontSize: '12px'}}, '国际版与中国版分别使用 CLI 本地登录态，不会迁移登录或回退到另一区域。')),
      h('fieldset', {disabled: locked, style: box},
        h('legend', null, h('span', {style: row}, '模型与独立委派设置',
          h('span', {style: {position: 'relative', display: 'inline-flex'}, onMouseEnter: () => {setHover(true); setDismissed(false)}, onMouseLeave: () => setHover(false)},
            h('button', {type: 'button', 'aria-label': '模型与独立委派安全说明', 'aria-describedby': tooltip ? helpId.current : undefined,
              onFocus: () => {setFocus(true); setDismissed(false)}, onBlur: () => setFocus(false), onClick: () => {setFocus(true); setDismissed(false)}, onKeyDown: (event: {key: string}) => {if (event.key === 'Escape') setDismissed(true)},
              style: {fontSize: '12px', minHeight: '24px', minWidth: '24px', padding: '1px 6px', color: secondary}}, '?'),
            tooltip ? h('span', {id: helpId.current, role: 'tooltip', style: {position: 'absolute', zIndex: 10, top: '100%', left: '-160px', width: 'min(320px, 70vw)', boxSizing: 'border-box', padding: '10px 12px', border, borderRadius: '6px', background: 'var(--dsw-alias-bg-base, var(--gray-2))', color: foreground, fontSize: '12px', fontWeight: 400, lineHeight: 1.6}}, safety) : null))),
        h('div', {style: {...row, justifyContent: 'space-between', marginBottom: '10px'}}, h('h3', null, '启用模型'), h('button', {type: 'button', disabled: locked || changedCli || !!status?.settingsError, onClick: () => void load('models')}, '获取模型列表')),
        changedCli ? h('p', {role: 'status'}, 'CLI 区域或路径尚未保存。请先保存设置，再获取该区域的模型；旧区域模型已隐藏。') : h('p', {style: {fontSize: '12px'}, role: 'status'}, status?.modelMessage),
        h('div', {role: 'group', 'aria-label': '启用模型', style: {...row, gap: '6px', marginBottom: '14px'}}, ...[...models].map(([id, label]) => h('button', {key: id, type: 'button', 'aria-label': `${label} (${id})`, 'aria-pressed': enabled.includes(id), style: {borderRadius: '16px', overflowWrap: 'anywhere', ...(enabled.includes(id) ? selectedStyle : {})},
          onClick: () => {if (dirtyCli() || pending.current) return; const current = draftRef.current!; const on = current.models.includes(id) && !current.hiddenModels.includes(id); update({models: on ? current.models : [...new Set([...current.models, id])], hiddenModels: on ? [...new Set([...current.hiddenModels, id])] : current.hiddenModels.filter(item => item !== id), defaultModel: on && current.defaultModel === id ? enabled.find(item => item !== id) ?? '' : current.defaultModel})}}, label))),
        h('div', {style: grid}, select('defaultModel', '默认模型', enabled, models), select('permissionMode', '权限模式', modes, new Map([['dont_ask', '不询问'], ['default', '默认'], ['accept_edits', '接受编辑']])), select('reasoningEffort', '默认推理强度', efforts)),
        h('div', {style: {...row, justifyContent: 'space-between'}}, h('label', null, h('input', {type: 'checkbox', checked: draft.askTool, onChange: (event: {target: {checked: boolean}}) => update({askTool: event.target.checked})}), '注册独立 ask 工具'),
          h('button', {type: 'button', disabled: locked || !!status?.settingsError || !!validation, onClick: () => void load('config')}, '保存设置')),
        validation ? h('p', {role: 'alert'}, validation) : null),
      h('details', {style: box}, h('summary', {style: {cursor: 'pointer', fontWeight: 600}}, '高级设置'),
        h('fieldset', {disabled: locked, style: {border: 0, padding: '12px 0 0', margin: 0, minWidth: 0}},
          h('div', {style: grid}, textField('qodercliBin', '国际版 CLI 路径'), textField('qoderclicnBin', '中国版 CLI 路径'), textField('workspaceRoot', 'CLI 工作目录（绝对路径）'), textField('tools', '独立委派允许的 CLI 工具')),
          h('p', {style: {fontSize: '12px'}}, '路径留空使用 PATH，只填写可执行文件。tools 默认留空，不启用 CLI 内置工具。auto 不发送推理强度参数；其他值只是请求，服务端未确认支持。'),
          h('div', {style: grid}, ...([['timeoutMs', '无进展超时（毫秒）', 1, 2147483647], ['maxConcurrency', '最大并发数', 1, 16], ['queueTimeoutMs', '排队超时（毫秒）', 1, 2147483647], ['stallWarnMs', '无进展提醒（毫秒，0 关闭）', 0, 2147483647], ['contextWindow', 'DSH 回退上下文预算', 1, Number.MAX_SAFE_INTEGER], ['maxPromptChars', '最大提示词字符数', 1, Number.MAX_SAFE_INTEGER]] as const).map(([key, label, min, max]) => h('label', {key, style: field}, label, h('input', {type: 'number', min, max, step: 1, value: Number.isNaN(draft[key]) ? '' : draft[key], onChange: (event: {target: {value: string}}) => update({[key]: event.target.value.trim() ? Number(event.target.value) : NaN})})))),
          h('label', {style: field}, '每模型上下文预算（JSON）', h('textarea', {value: contextText, onChange: (event: {target: {value: string}}) => {setContextText(event.target.value); try {const parsed: unknown = JSON.parse(event.target.value); contextInvalid.current = !record(parsed) || !Object.entries(parsed).every(([id, size]) => modelId(id) && integer(size, 1)); if (!contextInvalid.current) update({modelContext: parsed as Record<string, number>})} catch {contextInvalid.current = true}}})),
          h('p', {style: {fontSize: '12px'}}, '上下文预算仅用于 DSH 元数据，不覆盖 CLI 限制。无进展超时不是总时长上限，有效 ACP 进展会续期；无进展提醒不会中止调用。')))) : null,
    h('details', {style: box, 'aria-label': '运行记录'}, h('summary', {style: {cursor: 'pointer', fontWeight: 600}}, `运行记录（${status?.runs.length ?? 0}）`), h('p', {style: {fontSize: '12px'}}, '当前进程内最近 5 条，每 2 秒刷新。不展示提示词、原始输出或错误详情。'),
      h('div', {style: {maxHeight: '360px', overflowY: 'auto'}}, ...(status?.runs.length ? status.runs.map(run => h('article', {key: run.id, style: {borderTop: border, padding: '8px 0', overflowWrap: 'anywhere'}},
        h('p', null, `${({queued: '排队中', starting: '启动中', waiting: '等待响应', responding: '响应中', completed: '已完成', failed: '失败', cancelled: '已取消'} as Record<string, string>)[run.state]}；模型：${run.requestedModel}；推理强度请求：${run.requestedEffort}（未确认）`),
        run.lastProgressAt !== undefined ? h('p', null, `最近进展：${new Date(run.lastProgressAt).toLocaleTimeString()}`) : null,
        run.failure ? h('p', null, ({timeout: '无进展超时', 'queue-timeout': '排队超时', aborted: '已中止', error: '执行失败'} as Record<string, string>)[run.failure]) : null,
        run.warning ? h('p', {role: 'status'}, '长时间无进展，仍在等待；这不代表失败。') : null)) : [h('p', {key: 'empty'}, '暂无运行记录')]))))
}
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({name: 'settings.section', id: 'qoder-link', order: 20, label: 'Qoder Link'}, SettingsPanel))
  const panel = (props?: unknown) => record(props) && props.view === 'summary' ? null : h(SettingsPanel)
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({name: 'plugins.bundle.config', key: 'dsh-qoder-link'}, panel))
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({name: 'plugins.row.config', key: 'dsh-qoder-link#qoder-link'}, panel))
}
