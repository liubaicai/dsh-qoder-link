import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { LlmAdapter, ToolCallId, type GenerateOptions, type LlmModelInfo, type LlmResolvedModelInfo, type ReasoningEffortId, type StreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm'
import { selectedBin, QODER_EFFORTS, type QoderEffort, type PluginConfig } from './config.ts'
import { resolveEffort } from './effort.ts'
import { CallRuntime } from './runtime.ts'
import { buildPrompt, parseResponse } from './prompt.ts'
import { runQoder } from './runner.ts'

export type Runner = typeof runQoder

export { QODER_EFFORTS, type QoderEffort } from './config.ts';
const EFFORT_LABELS: Record<QoderEffort, string> = { auto: 'CLI 默认', low: '低', medium: '中', high: '高' };
export class QoderAdapter extends LlmAdapter {
  private readonly config: PluginConfig
  private readonly runner: Runner
  private readonly sessionCwd: (id: string) => string | undefined
  private readonly runtime: CallRuntime
  constructor(config: PluginConfig, runner: Runner = runQoder, sessionCwd: (id: string) => string | undefined = () => undefined, runtime = new CallRuntime(config)) {
    super(); this.config = config; this.runner = runner; this.sessionCwd = sessionCwd; this.runtime = runtime
  }
  override providerInfo() { return { id: 'qoder', name: 'Qoder CLI' } }
  override async listModels(): Promise<readonly LlmModelInfo[]> {
    if (!this.config.enabled) return []
    return this.config.models.filter(id => !this.config.hiddenModels.includes(id)).map(id => ({ provider: 'qoder', id, name: id === 'default' ? 'Qoder (CLI default)' : id, inputModalities: ['text'] }))
  }
  override async resolveModel(_provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider: 'qoder', id: model, name: model === 'default' ? 'Qoder (CLI default)' : model, inputModalities: ['text'],
      context: { contextWindow: model === 'default' ? this.config.contextWindow : (this.config.modelContext[model] ?? this.config.contextWindow) },
      // Exposing reasoning efforts makes DSH render its 思考等级 picker; the
      // chosen value flows back as options.reasoningEffort into --reasoning-effort (support depends on the selected model).
      reasoning: { efforts: QODER_EFFORTS.map(id => ({ id: id as ReasoningEffortId, name: `${id} ${EFFORT_LABELS[id]}` })) },
    }
  }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason ?? new Error('Aborted')
    return { model: await this.resolveModel(provider, model), stream: (options: GenerateOptions) => this.stream({ ...options, provider, model, signal: options.signal ?? signal }) }
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const cfg = this.config
    if (!cfg.enabled) throw new Error('Qoder bridge is disabled')
    const selectedModel = options.model || cfg.defaultModel
    if (!cfg.models.includes(selectedModel) || cfg.hiddenModels.includes(selectedModel)) throw new Error('Qoder model is not enabled in settings')
    const tools = options.purpose ? [] : options.tools ?? []
    const structured = tools.length > 0
    const cwd = cfg.workspaceRoot || (options.sessionId ? this.sessionCwd(options.sessionId) : undefined) || process.cwd()
    if (!isAbsolute(cwd)) throw new Error('Qoder workspace must be an absolute path')
    const prompt = buildPrompt(options.messages, tools, cfg.maxPromptChars)
    let index = 0
    let open: 'text' | 'reasoning' | undefined
    let accumulated = ''
    let rawText = ''
    let resultText = ''
    let structuredOutput: unknown
    let usage: TokenUsage | undefined
    let sessionId: string | undefined
    const close = (): StreamChunk[] => {
      if (!open) return []
      const chunk: StreamChunk = { type: 'block-end', index, block: { type: open, text: accumulated } }
      open = undefined; accumulated = ''; index++
      return [chunk]
    }
    const append = (type: 'text' | 'reasoning', text: string): StreamChunk[] => {
      if (!text) return []
      const chunks: StreamChunk[] = []
      if (open !== type) {
        chunks.push(...close()); open = type
        chunks.push({ type: 'block-start', index, blockType: type })
      }
      accumulated += text
      chunks.push({ type: type === 'text' ? 'text-delta' : 'reasoning-delta', index, text })
      return chunks
    }
    try {
      // DSH executes validated tool envelopes; the CLI cannot execute local tools.
      for await (const event of this.runtime.run({
        prompt, systemPrompt: options.system, cwd, bin: selectedBin(cfg), cliVariant: cfg.cliVariant,
        model: (options.model || cfg.defaultModel) === 'default' ? undefined : (options.model || cfg.defaultModel),
        effort: resolveEffort(options.reasoningEffort, cfg.reasoningEffort), permissionMode: 'dont_ask', tools: '',
        timeoutMs: cfg.timeoutMs, signal: options.signal,
      }, 'model', this.runner, structured ? event => {
        parseResponse(event.structuredOutput ?? (event.text || rawText), tools)
      } : undefined)) {
        if (event.type === 'text') {
          rawText += event.delta
          if (!structured) yield* append('text', event.delta)
        } else if (event.type === 'reasoning' && !structured) yield* append('reasoning', event.delta)
        else if (event.type === 'usage') usage = { inputTokens: event.input, outputTokens: event.output, cacheReadTokens: event.cacheRead, cacheWriteTokens: event.cacheWrite }
        else if (event.type === 'result') { sessionId = event.sessionId; resultText = event.text; structuredOutput = event.structuredOutput }
      }
      if (structured) {
        const response = parseResponse(structuredOutput ?? (resultText || rawText), tools)
        yield* append('text', response.text)
        yield* close()
        for (const call of response.toolCalls) {
          const id = ToolCallId('qoder-' + randomUUID())
          yield { type: 'block-start', index, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: call.arguments }
          yield { type: 'block-end', index, block: { type: 'tool-call', id, name: call.name, arguments: call.arguments } }
          index++
        }
        if (usage) yield { type: 'usage', usage }
        yield { type: 'finish', reason: { kind: response.toolCalls.length ? 'tool-calls' : 'stop' }, replayState: { response: { sessionId: sessionId ?? null } } }
      } else {
        if (!rawText && resultText) yield* append('text', resultText)
        yield* close()
        if (usage) yield { type: 'usage', usage }
        yield { type: 'finish', reason: { kind: 'stop' }, replayState: { response: { sessionId: sessionId ?? null } } }
      }
    } catch (error) {
      yield* close()
      if (usage) yield { type: 'usage', usage }
      yield { type: 'finish', reason: { kind: options.signal?.aborted ? 'aborted' : 'error', failure: { code: options.signal?.aborted ? 'ABORTED' : 'QODER_ERROR', message: error instanceof Error ? error.message : String(error) } } }
    }
  }
}
