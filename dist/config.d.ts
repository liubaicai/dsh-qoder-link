export declare const QODER_EFFORTS: readonly ["auto", "low", "medium", "high"];
export type QoderEffort = typeof QODER_EFFORTS[number];
export declare function isQoderEffort(value: unknown): value is QoderEffort;
export interface PluginConfig {
    enabled: boolean;
    cliVariant: 'qodercli' | 'qoderclicn';
    qodercliBin: string;
    qoderclicnBin: string;
    defaultModel: string;
    models: string[];
    hiddenModels: string[];
    workspaceRoot: string;
    permissionMode: 'dont_ask' | 'default' | 'accept_edits';
    tools: string;
    /** ACP inactivity budget; progress resets this deadline. */
    timeoutMs: number;
    reasoningEffort: string;
    maxConcurrency: number;
    queueTimeoutMs: number;
    stallWarnMs: number;
    contextWindow: number;
    /** Per-model context windows (models.dev) persisted by model discovery. */
    modelContext: Record<string, number>;
    maxPromptChars: number;
    askTool: boolean;
}
export declare function resolveConfig(entry?: Record<string, unknown>, env?: NodeJS.ProcessEnv): PluginConfig;
/** No cross-region fallback: each binary uses its own CLI login. */
export declare function selectedBin(config: PluginConfig): string;
