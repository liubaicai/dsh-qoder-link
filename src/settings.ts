import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveConfig, type PluginConfig } from './config.ts'

const editable = new Set(['permissionMode', 'models', 'hiddenModels', 'defaultModel', 'tools', 'modelContext',
  'reasoningEffort', 'maxConcurrency', 'queueTimeoutMs', 'stallWarnMs', 'cliVariant',
  'qodercliBin', 'qoderclicnBin', 'enabled', 'workspaceRoot', 'timeoutMs', 'contextWindow', 'maxPromptChars', 'askTool'])
export function settingsPath(): string {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'plugins', 'dsh-qoder-link', 'settings.json')
}

/** Only non-secret UI settings are stored here. Invalid files are not silently replaced. */
export class SettingsStore {
  readonly config: PluginConfig
  private saved: Record<string, unknown>
  private readonly entry: Record<string, unknown>
  readonly path: string
  /** Diagnostic-only recovery keeps the panel available, never execution or writes. */
  readonly loadError?: string
  constructor(entry: Record<string, unknown> = {}, path = settingsPath()) {
    this.entry = entry; this.path = path
    this.saved = {}
    try {
      let saved: unknown = {}
      try { saved = JSON.parse(readFileSync(path, 'utf8')) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      this.saved = validateKeys(saved)
      this.config = resolveConfig({...entry, ...this.saved})
    } catch {
      // Never overwrite the bad file or inherit unsafe/invalid administrator environment.
      // External repair followed by a restart is the explicit recovery step.
      this.loadError = 'Qoder settings could not be loaded. Provider and delegation are disabled. Repair the plugin settings.json file or administrator configuration and restart DSH; the original file has not been changed.'
      this.config = resolveConfig({enabled:false, askTool:false, permissionMode:'dont_ask', tools:''}, {})
    }
  }
  update(patch: unknown): PluginConfig {
    if (this.loadError) throw new Error(this.loadError)
    const updates = validateKeys(patch)
    const saved = {...this.saved, ...updates}
    const next = resolveConfig({...this.entry, ...saved})
    if (next.hiddenModels.includes(next.defaultModel)) throw new Error('Default model must be enabled')
    if (!next.models.some(id => !next.hiddenModels.includes(id))) throw new Error('Enable at least one model')
    mkdirSync(dirname(this.path), {recursive:true})
    const tmp = this.path + '.' + randomUUID() + '.tmp'
    writeFileSync(tmp, JSON.stringify(saved, null, 2) + '\n', {mode:0o600, flag:'wx'})
    renameSync(tmp, this.path)
    this.saved = saved
    // Preserve identity so registered adapters and tools read live settings.
    Object.assign(this.config, next)
    return this.config
  }
}
function validateKeys(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings must be an object')
  for (const key of Object.keys(value)) if (!editable.has(key)) throw new Error(`Unsupported setting: ${key}`)
  return value as Record<string, unknown>
}
