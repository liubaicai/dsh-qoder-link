import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selectedBin, type PluginConfig } from './config.ts'
import { childEnv, resolveQoderBin, killTree } from './runner.ts'
import { isModelIdentifier } from './metadata.ts'

export const modelFailure = '模型列表获取失败，请检查 CLI 安装、登录与网络后重试。'
export const modelFailures = {
  unavailable: '无法启动所选 CLI，请检查安装与自定义路径。',
  timeout: '获取模型列表超时，请稍后重试并检查网络。',
  exit: 'CLI 未能获取模型列表，请检查登录与网络后重试。',
  output: 'CLI 模型列表输出超出限制，请检查 CLI 版本。',
  format: 'CLI 模型列表格式无法识别，请检查 CLI 版本。',
} as const
export class ModelDiscoveryError extends Error {
  readonly kind: keyof typeof modelFailures
  constructor(kind: keyof typeof modelFailures) { super(modelFailures[kind]); this.name = 'ModelDiscoveryError'; this.kind = kind }
}
/** Only fixed categories may cross the HTTP/UI boundary, never Error.message. */
export function modelFailureMessage(error: unknown): string {
  return error instanceof ModelDiscoveryError && Object.hasOwn(modelFailures, error.kind) ? modelFailures[error.kind] : modelFailure
}
/** Parse only the observed official --list-models table, never arbitrary diagnostics. */
export function parseModels(output: string): {id:string;name:string}[] {
  const lines = output.replace(/\x1b\[[0-9;]*m/g, '').trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.shift() !== 'MODEL' || !lines.length || lines.length > 256 || lines.some(line => !isModelIdentifier(line))) throw new ModelDiscoveryError('format')
  return [...new Set(lines)].map(id => ({id, name:id}))
}
/** No prompt, auth inspection, shell, or workspace settings: CLI owns authentication. */
export async function discoverModels(config: PluginConfig, timeoutMs = 12000): Promise<{models:{id:string;name:string}[];message:string}> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000) throw new Error(modelFailure)
  let cwd: string | undefined
  try {
    const bin = await resolveQoderBin(selectedBin(config), process.cwd()).catch(() => { throw new ModelDiscoveryError('unavailable') })
    cwd = await mkdtemp(join(tmpdir(), 'qoder-models-'))
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(bin.command, [...bin.args, '--list-models'], {cwd, env:childEnv(), shell:false, windowsHide:true, detached:process.platform !== 'win32', stdio:['ignore','pipe','pipe']})
      let settled = false, stopping = false, bytes = 0
      const chunks: Buffer[] = []
      const finish = (error?: Error) => {
        if (settled) return
        settled = true; clearTimeout(timer)
        if (error) reject(error); else resolve(Buffer.concat(chunks).toString('utf8'))
      }
      const stop = (kind: 'timeout' | 'output') => {
        if (settled || stopping) return
        stopping = true
        void killTree(child).catch(() => {}).finally(() => finish(new ModelDiscoveryError(kind)))
      }
      const timer = setTimeout(() => stop('timeout'), timeoutMs)
      child.once('error', () => finish(new ModelDiscoveryError('unavailable')))
      child.once('close', code => { if (!stopping) finish(code === 0 ? undefined : new ModelDiscoveryError('exit')) })
      child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 65536) stop('output'); else if (!stopping) chunks.push(chunk) })
      child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 65536) stop('output') })
    })
    return {models:parseModels(output), message:'已获取当前 CLI 模型列表。'}
  } catch (error) {
    if (error instanceof ModelDiscoveryError) throw error
    throw new Error(modelFailure)
  } finally { if (cwd) await rm(cwd, {recursive:true, force:true}).catch(() => {}) }
}
