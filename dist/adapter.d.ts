import { LlmAdapter, type GenerateOptions, type LlmModelInfo, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { type PluginConfig } from './config.ts';
import { CallRuntime } from './runtime.ts';
import { runQoder } from './runner.ts';
export type Runner = typeof runQoder;
export { QODER_EFFORTS, type QoderEffort } from './config.ts';
export declare class QoderAdapter extends LlmAdapter {
    private readonly config;
    private readonly runner;
    private readonly sessionCwd;
    private readonly runtime;
    constructor(config: PluginConfig, runner?: Runner, sessionCwd?: (id: string) => string | undefined, runtime?: CallRuntime);
    providerInfo(): {
        id: string;
        name: string;
    };
    listModels(): Promise<readonly LlmModelInfo[]>;
    resolveModel(_provider: string, model: string): Promise<LlmResolvedModelInfo>;
    prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<{
        model: LlmResolvedModelInfo;
        stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>;
    }>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
