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
interface Run {id: string; state: string; requestedModel: string; requestedEffort: string; queuedAt: number; warning: boolean}
interface Status {config: Config; runs: Run[]}
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
export function parseStatus(value: unknown): Status {
  if (!record(value) || validateConfig(value.config) || !Array.isArray(value.runs)) throw new Error('服务端状态格式无效')
  const runs: Run[] = []
  for (const run of value.runs) {
    if (!record(run) || typeof run.id !== 'string' || !['queued', 'starting', 'waiting', 'responding', 'completed', 'failed', 'cancelled'].includes(String(run.state)) || !integer(run.queuedAt, 0)) continue
    runs.push({id: run.id, state: String(run.state), requestedModel: modelId(run.requestedModel) ? run.requestedModel : 'unknown', requestedEffort: efforts.includes(String(run.requestedEffort)) ? String(run.requestedEffort) : 'auto', queuedAt: run.queuedAt, warning: run.warning === true})
  }
  return {config: value.config as unknown as Config, runs: runs.sort((a, b) => b.queuedAt - a.queuedAt).slice(0, 5)}
}
async function request(action: 'status' | 'config', body?: Config): Promise<Status> {
  let response: Response
  try {
    response = await fetch(`/plugins/qoder-link/${action}`, {method: action === 'status' ? 'GET' : 'POST', credentials: 'same-origin', mode: 'same-origin', signal: AbortSignal.timeout(20000),
      ...(body ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {})})
  } catch { throw new Error('请求失败或超时，请检查连接后重试。') }
  if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}），请检查设置后重试。`)
  try { return parseStatus(await response.json()) } catch { throw new Error('服务端状态格式无效，请重试。') }
}
const border = '0.5px solid var(--dsw-alias-border-l2, var(--gray-6))'
const control = {font: 'inherit', fontSize: '13px', minHeight: '36px', boxSizing: 'border-box', border, borderRadius: '6px', padding: '8px 10px', color: 'var(--dsw-alias-label-primary, var(--gray-12))', background: 'var(--dsw-alias-bg-layer-1, var(--gray-2))'}
const field = {display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px'}
const box = {padding: '16px', border, borderRadius: '8px', marginBottom: '16px'}
function h(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown {
  const styles: Record<string, object> = {
    input: props?.type === 'checkbox' ? {width: '16px', height: '16px', accentColor: 'var(--accent-9)', marginRight: '8px'} : {...control, width: '100%'},
    select: {...control, width: '100%'}, textarea: {...control, width: '100%', minHeight: '80px'},
    button: {...control, cursor: props?.disabled ? 'not-allowed' : 'pointer', opacity: props?.disabled ? 0.5 : 1},
    h2: {fontSize: '18px', margin: '0 0 12px', fontWeight: 600}, h3: {fontSize: '14px', margin: '0 0 12px', fontWeight: 600},
    p: {margin: '10px 0', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary, var(--gray-11))'},
  }
  return createElement(type, {...props, style: {...(typeof type === 'string' ? styles[type] : {}), ...(props?.role === 'alert' ? {color: 'var(--red-11)'} : {}), ...(props?.style as object ?? {})}}, ...children)
}
export function loginInstructions(variant: Config['cliVariant']): string {
  return `在运行 DSH 的同一台机器、同一系统账户下打开终端，运行 ${variant} 并按 CLI 自身的提示完成登录。若配置了自定义路径，请运行对应的可执行文件。此页面不验证登录状态，也不导入凭据。`
}
function SettingsPanel(): unknown {
  const [status, setStatus] = useState<Status | null>(null)
  const [draft, setDraft] = useState<Config | null>(null)
  const [busy, setBusy] = useState<'load' | 'save' | ''>('load')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [modelText, setModelText] = useState('')
  const [hiddenText, setHiddenText] = useState('')
  const [contextText, setContextText] = useState('{}')
  const live = useRef(false)
  const pending = useRef(false)
  const load = async (save = false) => {
    if (pending.current) return
    pending.current = true; setBusy(save ? 'save' : 'load'); setError(''); setMessage('')
    try {
      const result = await request(save ? 'config' : 'status', save && draft ? draft : undefined)
      if (!live.current) return
      setStatus(result)
      if (save || !draft) {
        setDraft(result.config); setModelText(result.config.models.join('\n')); setHiddenText(result.config.hiddenModels.join('\n')); setContextText(JSON.stringify(result.config.modelContext, null, 2))
      }
      setMessage(save ? '设置已保存。后续调用使用新设置，正在运行的调用不受影响。' : '状态已刷新；未保存的修改已保留。')
    } catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : '请求失败，请重试。') }
    finally { pending.current = false; if (live.current) setBusy('') }
  }
  useEffect(() => { live.current = true; void load(); return () => {live.current = false} }, [])
  const update = (patch: Partial<Config>) => { setDraft(previous => previous ? {...previous, ...patch} : previous); setMessage('') }
  const valueChange = (key: keyof Config) => (event: {target: {value: string}}) => update({[key]: event.target.value})
  const textField = (key: 'qodercliBin' | 'qoderclicnBin' | 'workspaceRoot' | 'tools', label: string, placeholder = '') => h('label', {style: field}, label, h('input', {value: draft?.[key] ?? '', placeholder, onChange: valueChange(key)}))
  const select = (key: 'cliVariant' | 'defaultModel' | 'permissionMode' | 'reasoningEffort', label: string, values: string[]) => h('label', {style: field}, label, h('select', {value: draft?.[key], onChange: valueChange(key)}, ...values.map(value => h('option', {key: value, value}, value))))
  const split = (value: string) => [...new Set(value.split(/[\n,]/).map(item => item.trim()).filter(Boolean))]
  let contextError = ''
  try { const parsed: unknown = JSON.parse(contextText); if (!record(parsed) || !Object.entries(parsed).every(([id, size]) => modelId(id) && integer(size, 1))) contextError = '模型上下文映射须为模型 ID 到正整数的 JSON 对象' } catch { contextError = '模型上下文映射不是有效 JSON' }
  const validation = draft ? validateConfig(draft) || contextError : ''
  return h('section', {style: {fontSize: '13px', lineHeight: 1.6, color: 'var(--dsw-alias-label-primary, var(--gray-12))', maxWidth: '860px'}, 'aria-busy': !!busy},
    h('h2', null, 'Qoder Link'), h('p', null, '通过本机 Qoder CLI 接入 DSH。两个 CLI 版本分别保存路径，共用模型与运行设置。'),
    error ? h('p', {role: 'alert'}, error) : null,
    busy ? h('p', {role: 'status'}, busy === 'save' ? '正在保存设置…' : '正在加载状态…') : null,
    message ? h('p', {role: 'status'}, message) : null,
    h('button', {type: 'button', disabled: !!busy, onClick: () => void load()}, error && !draft ? '重试加载' : '刷新状态'),
    draft ? h('fieldset', {disabled: !!busy, style: {border: 0, padding: 0, margin: '16px 0', minWidth: 0}},
      h('section', {style: box}, h('h3', null, 'CLI 与登录'),
        h('label', {style: field}, h('span', null, h('input', {type: 'checkbox', checked: draft.enabled, onChange: (event: {target: {checked: boolean}}) => update({enabled: event.target.checked})}), '启用 Qoder Link')),
        select('cliVariant', '使用的 CLI 版本', ['qodercli', 'qoderclicn']),
        textField('qodercliBin', 'qodercli 可执行文件路径', '留空使用 PATH 中的 qodercli'),
        textField('qoderclicnBin', 'qoderclicn 可执行文件路径', '留空使用 PATH 中的 qoderclicn'),
        h('p', null, loginInstructions(draft.cliVariant)), h('p', null, '切换版本不会迁移登录，也不会回退到另一个 CLI。路径仅填写可执行文件，不要附加命令参数。')),
      h('section', {style: box}, h('h3', null, '模型与运行'),
        h('label', {style: field}, '共享模型列表（每行一个 ID）', h('textarea', {value: modelText, onChange: (event: {target: {value: string}}) => {setModelText(event.target.value); update({models: split(event.target.value)})}})),
        select('defaultModel', '默认模型', draft.models.filter(id => !draft.hiddenModels.includes(id))),
        select('reasoningEffort', '推理强度', efforts), h('p', null, 'auto 不发送推理强度参数。其他值只是请求，不代表服务端已确认支持。模型 ID 的可用性由当前 CLI 与服务端决定。'),
        ...([['timeoutMs', '调用超时（毫秒）', 1, 2147483647], ['maxConcurrency', '最大并发数', 1, 16], ['queueTimeoutMs', '排队超时（毫秒）', 1, 2147483647], ['stallWarnMs', '无进展提醒（毫秒，0 关闭）', 0, 2147483647]] as const).map(([key, label, min, max]) => h('label', {key, style: field}, label, h('input', {type: 'number', min, max, step: 1, value: Number.isNaN(draft[key]) ? '' : draft[key], onChange: (event: {target: {value: string}}) => update({[key]: event.target.value.trim() ? Number(event.target.value) : NaN})})))),
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
    h('section', {style: box}, h('h3', null, '最近运行'), h('p', null, '最多显示当前进程内最近 5 条记录。点击刷新状态更新，不展示提示词、原始输出或错误详情。'),
      ...(status?.runs.length ? status.runs.map(run => h('article', {key: run.id, style: {borderTop: border, padding: '8px 0', overflowWrap: 'anywhere'}},
        h('p', null, `${({queued: '排队中', starting: '启动中', waiting: '等待响应', responding: '响应中', completed: '已完成', failed: '失败', cancelled: '已取消'} as Record<string, string>)[run.state]}；模型：${run.requestedModel}；推理强度请求：${run.requestedEffort}（未确认）`),
        run.warning ? h('p', null, '长时间无进展，仍在等待；这不代表失败。') : null)) : [h('p', {key: 'empty'}, '暂无运行记录')]))
  )
}
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({name: 'settings.section', id: 'qoder-link', order: 20, label: 'Qoder Link'}, SettingsPanel))
  const panel = (props?: unknown) => record(props) && props.view === 'summary' ? null : h(SettingsPanel)
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({name: 'plugins.bundle.config', key: 'dsh-qoder-link'}, panel))
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({name: 'plugins.row.config', key: 'dsh-qoder-link#qoder-link'}, panel))
}
