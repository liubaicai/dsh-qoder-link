import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import { selectedBin, QODER_EFFORTS } from "./config.js";
import { resolveEffort } from "./effort.js";
import { CallRuntime } from "./runtime.js";
import { buildPrompt, parseResponse } from "./prompt.js";
import { runQoder } from "./runner.js";
export { QODER_EFFORTS } from "./config.js";
const EFFORT_LABELS = { auto: 'CLI 默认', low: '低', medium: '中', high: '高' };
export class QoderAdapter extends LlmAdapter {
    config;
    runner;
    sessionCwd;
    runtime;
    constructor(config, runner = runQoder, sessionCwd = () => undefined, runtime = new CallRuntime(config)) {
        super();
        this.config = config;
        this.runner = runner;
        this.sessionCwd = sessionCwd;
        this.runtime = runtime;
    }
    providerInfo() { return { id: 'qoder', name: 'Qoder CLI' }; }
    async listModels() {
        if (!this.config.enabled)
            return [];
        return this.config.models.filter(id => !this.config.hiddenModels.includes(id)).map(id => ({ provider: 'qoder', id, name: id === 'default' ? 'Qoder (CLI default)' : id, inputModalities: ['text'] }));
    }
    async resolveModel(_provider, model) {
        return {
            provider: 'qoder', id: model, name: model === 'default' ? 'Qoder (CLI default)' : model, inputModalities: ['text'],
            context: { contextWindow: model === 'default' ? this.config.contextWindow : (this.config.modelContext[model] ?? this.config.contextWindow) },
            // Exposing reasoning efforts makes DSH render its 思考等级 picker; the
            // chosen value flows back as options.reasoningEffort into --reasoning-effort (support depends on the selected model).
            reasoning: { efforts: QODER_EFFORTS.map(id => ({ id: id, name: `${id} ${EFFORT_LABELS[id]}` })) },
        };
    }
    async prepareCall(provider, model, signal) {
        if (signal?.aborted)
            throw signal.reason ?? new Error('Aborted');
        return { model: await this.resolveModel(provider, model), stream: (options) => this.stream({ ...options, provider, model, signal: options.signal ?? signal }) };
    }
    async *stream(options) {
        const cfg = this.config;
        if (!cfg.enabled)
            throw new Error('Qoder bridge is disabled');
        const selectedModel = options.model || cfg.defaultModel;
        if (!cfg.models.includes(selectedModel) || cfg.hiddenModels.includes(selectedModel))
            throw new Error('Qoder model is not enabled in settings');
        const tools = options.purpose ? [] : options.tools ?? [];
        const structured = tools.length > 0;
        const cwd = cfg.workspaceRoot || (options.sessionId ? this.sessionCwd(options.sessionId) : undefined) || process.cwd();
        if (!isAbsolute(cwd))
            throw new Error('Qoder workspace must be an absolute path');
        const prompt = buildPrompt(options.messages, tools, cfg.maxPromptChars);
        let index = 0;
        let open;
        let accumulated = '';
        let rawText = '';
        let resultText = '';
        let structuredOutput;
        let usage;
        let sessionId;
        const close = () => {
            if (!open)
                return [];
            const chunk = { type: 'block-end', index, block: { type: open, text: accumulated } };
            open = undefined;
            accumulated = '';
            index++;
            return [chunk];
        };
        const append = (type, text) => {
            if (!text)
                return [];
            const chunks = [];
            if (open !== type) {
                chunks.push(...close());
                open = type;
                chunks.push({ type: 'block-start', index, blockType: type });
            }
            accumulated += text;
            chunks.push({ type: type === 'text' ? 'text-delta' : 'reasoning-delta', index, text });
            return chunks;
        };
        try {
            // DSH executes validated tool envelopes; the CLI cannot execute local tools.
            for await (const event of this.runtime.run({
                prompt, systemPrompt: options.system, cwd, bin: selectedBin(cfg),
                model: (options.model || cfg.defaultModel) === 'default' ? undefined : (options.model || cfg.defaultModel),
                effort: resolveEffort(options.reasoningEffort, cfg.reasoningEffort), permissionMode: 'dont_ask', tools: '',
                timeoutMs: cfg.timeoutMs, signal: options.signal,
            }, 'model', this.runner, structured ? event => {
                parseResponse(event.structuredOutput ?? (event.text || rawText), tools);
            } : undefined)) {
                if (event.type === 'text') {
                    rawText += event.delta;
                    if (!structured)
                        yield* append('text', event.delta);
                }
                else if (event.type === 'reasoning' && !structured)
                    yield* append('reasoning', event.delta);
                else if (event.type === 'usage')
                    usage = { inputTokens: event.input, outputTokens: event.output, cacheReadTokens: event.cacheRead, cacheWriteTokens: event.cacheWrite };
                else if (event.type === 'result') {
                    sessionId = event.sessionId;
                    resultText = event.text;
                    structuredOutput = event.structuredOutput;
                }
            }
            if (structured) {
                const response = parseResponse(structuredOutput ?? (resultText || rawText), tools);
                yield* append('text', response.text);
                yield* close();
                for (const call of response.toolCalls) {
                    const id = ToolCallId('qoder-' + randomUUID());
                    yield { type: 'block-start', index, blockType: 'tool-call' };
                    yield { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: call.arguments };
                    yield { type: 'block-end', index, block: { type: 'tool-call', id, name: call.name, arguments: call.arguments } };
                    index++;
                }
                if (usage)
                    yield { type: 'usage', usage };
                yield { type: 'finish', reason: { kind: response.toolCalls.length ? 'tool-calls' : 'stop' }, replayState: { response: { sessionId: sessionId ?? null } } };
            }
            else {
                if (!rawText && resultText)
                    yield* append('text', resultText);
                yield* close();
                if (usage)
                    yield { type: 'usage', usage };
                yield { type: 'finish', reason: { kind: 'stop' }, replayState: { response: { sessionId: sessionId ?? null } } };
            }
        }
        catch (error) {
            yield* close();
            if (usage)
                yield { type: 'usage', usage };
            yield { type: 'finish', reason: { kind: options.signal?.aborted ? 'aborted' : 'error', failure: { code: options.signal?.aborted ? 'ABORTED' : 'QODER_ERROR', message: error instanceof Error ? error.message : String(error) } } };
        }
    }
}
//# sourceMappingURL=adapter.js.map