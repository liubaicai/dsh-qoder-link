import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SettingsStore } from './settings.ts'
import type { PluginConfig } from './config.ts'

export interface WebServerLike {
  register(route: {kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void}): unknown
}
export interface ModelCatalog { models: {id: string; name: string}[]; message: string }
export type RefreshModels = (config: PluginConfig) => Promise<ModelCatalog>
const configKeys = ['enabled', 'cliVariant', 'qodercliBin', 'qoderclicnBin', 'models', 'defaultModel', 'hiddenModels', 'tools', 'permissionMode', 'reasoningEffort', 'timeoutMs', 'contextWindow', 'maxPromptChars', 'workspaceRoot', 'maxConcurrency', 'queueTimeoutMs', 'stallWarnMs', 'askTool', 'modelContext'] as const
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const modelId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.exec(value)?.[0] === value && !value.includes(':/') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..')
const discoveryKey = (config: PluginConfig) => JSON.stringify([config.cliVariant, config.qodercliBin, config.qoderclicnBin, config.workspaceRoot])

/** GET is passive; discovery is explicit and results are bound to the CLI configuration epoch. */
export function registerSettingsRoutes(server: WebServerLike, store: SettingsStore, notify: () => void,
  readRuns: () => unknown[] = () => [], refreshModels?: RefreshModels): () => void {
  let disposed = false, epoch = 0, refreshing = false
  let key = discoveryKey(store.config)
  let catalogModels: ModelCatalog['models'] = [], modelMessage = '模型列表尚未加载。'
  const disposers: (() => void)[] = []
  const syncIdentity = () => {
    const next = discoveryKey(store.config)
    if (next !== key) { key = next; epoch++; catalogModels = []; modelMessage = '模型列表尚未加载。' }
  }
  const snapshot = () => {
    syncIdentity()
    return {...(store.loadError ? {settingsError:store.loadError} : {}), config: Object.fromEntries(configKeys.map(key => [key, store.config[key]])), runs: publicRuns(readRuns()), catalogModels, modelMessage}
  }
  for (const action of ['status', 'config', 'models'] as const) {
    const dispose = server.register({kind: 'exact', path: `/plugins/qoder-link/${action}`, handler: (req, res) => {
      void (async () => {
        const send = (code: number, body: unknown) => {
          res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
          res.end(JSON.stringify(body))
        }
        if (disposed) { send(503, {error: 'Plugin is disposed'}); return }
        const method = action === 'status' ? 'GET' : 'POST'
        if (req.method !== method) { res.setHeader('Allow', method); send(405, {error: `${method} only`}); return }
        const origin = req.headers.origin
        if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && !sameHost(origin, req.headers.host))) {
          send(403, {error: 'Cross-origin request denied'}); return
        }
        try {
          syncIdentity()
          if (action !== 'status') {
            if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) { send(415, {error: 'JSON required'}); return }
            const body = await readJson(req)
            if (!record(body) || Object.keys(body).some(key => action === 'models' || !(configKeys as readonly string[]).includes(key))) {
              send(400, {error: 'Invalid request fields'}); return
            }
            if (disposed) { send(503, {error: 'Plugin is disposed'}); return }
            if (action === 'config') {
              store.update(body); syncIdentity()
              try { notify() } catch { /* saved settings survive listener failure */ }
            } else {
              if (!refreshModels) { send(503, {error: 'Model discovery unavailable'}); return }
              if (store.loadError) { send(503, {error: 'Repair settings before model discovery'}); return }
              // One discovery process across all configuration epochs. A region switch
              // invalidates publication, but cannot free the slot before process cleanup.
              if (refreshing) { send(409, {error: 'Model discovery is already running; retry after it finishes'}); return }
              syncIdentity()
              const startedEpoch = epoch
              const config = structuredClone(store.config)
              let result: ModelCatalog
              refreshing = true
              try { result = await refreshModels(config) }
              catch {
                syncIdentity()
                if (!disposed && startedEpoch === epoch) modelMessage = '模型列表获取失败，请检查 CLI 安装、登录与网络后重试。'
                throw new Error('Model discovery failed')
              } finally { refreshing = false }
              if (disposed) { send(503, {error: 'Plugin is disposed'}); return }
              syncIdentity()
              if (startedEpoch !== epoch) { send(409, {error: 'Model discovery configuration changed; refresh again'}); return }
              if (!result || !Array.isArray(result.models) || typeof result.message !== 'string') throw new Error()
              const seen = new Set<string>()
              catalogModels = result.models.filter(row => row && modelId(row.id) && !seen.has(row.id) && !!seen.add(row.id)).slice(0, 1000).map(row => ({id:row.id,name:typeof row.name === 'string' && row.name.length <= 128 && !/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(row.name) ? row.name : row.id}))
              modelMessage = '已获取当前 CLI 模型列表。'
            }
          }
          send(200, snapshot())
        } catch {
          // Never echo parser, filesystem, CLI or submitted-value diagnostics.
          send(action === 'status' ? 500 : 400, {error: action === 'models' ? 'Model discovery failed; check the selected CLI and its login.' : action === 'config' ? 'Settings save failed; check values and directory permissions.' : 'Status read failed; retry.'})
        }
      })()
    }})
    if (typeof dispose === 'function') disposers.push(dispose as () => void)
  }
  return () => { if (disposed) return; disposed = true; epoch++; for (const dispose of disposers.reverse()) dispose() }
}
function sameHost(origin: string, host: string | undefined): boolean {
  try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.origin === origin && url.host === host } catch { return false }
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += data.length
    if (size > 32768) throw new Error('Request body too large')
    chunks.push(data)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}
/** Deliberate allowlist: prompts, outputs, errors, credentials and billing never leave the runner. */
function publicRuns(values: unknown[]): Record<string, unknown>[] {
  if (!Array.isArray(values)) return []
  const result: Record<string, unknown>[] = []
  for (const run of values) {
    if (!record(run) || typeof run.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(run.id)
      || !['model', 'ask'].includes(String(run.source))
      || !['queued', 'starting', 'waiting', 'responding', 'completed', 'failed', 'cancelled'].includes(String(run.state))
      || typeof run.queuedAt !== 'number' || !Number.isFinite(run.queuedAt) || run.queuedAt < 0) continue
    const clean: Record<string, unknown> = {id: run.id, source: run.source, state: run.state, queuedAt: run.queuedAt,
      requestedModel: modelId(run.requestedModel) ? run.requestedModel : 'unknown',
      requestedEffort: ['auto', 'low', 'medium', 'high'].includes(String(run.requestedEffort)) ? run.requestedEffort : 'auto',
      warning: run.warning === true, contextOverrideSent: false, reasoningConfirmed: false,
      queuePosition: Number.isSafeInteger(run.queuePosition) && Number(run.queuePosition) >= 0 ? run.queuePosition : 0}
    if (modelId(run.returnedModel)) clean.returnedModel = run.returnedModel
    if (run.contextSource === 'model' || run.contextSource === 'fallback') clean.contextSource = run.contextSource
    for (const key of ['contextWindow', 'startedAt', 'lastProgressAt', 'endedAt']) {
      if (typeof run[key] === 'number' && Number.isFinite(run[key]) && run[key] >= 0) clean[key] = run[key]
    }
    if (['timeout', 'queue-timeout', 'aborted', 'error'].includes(String(run.failure))) clean.failure = run.failure
    // Keep only five candidates; insert after ties for stable input ordering.
    const position = result.findIndex(entry => Number(entry.queuedAt) < Number(run.queuedAt))
    if (position >= 0) result.splice(position, 0, clean)
    else if (result.length < 5) result.push(clean)
    if (result.length > 5) result.pop()
  }
  return result
}
