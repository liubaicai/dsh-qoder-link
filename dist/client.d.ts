export declare const name = "dsh-qoder-link-client";
export declare const inject: string[];
export interface ClientContext {
    slots: {
        inject(name: string, register: () => () => void): void;
        register(options: {
            name: string;
            id?: string;
            key?: string;
            order?: number;
            label?: string;
        }, component: (props?: unknown) => unknown): () => void;
    };
}
interface Config {
    enabled: boolean;
    cliVariant: 'qodercli' | 'qoderclicn';
    qodercliBin: string;
    qoderclicnBin: string;
    models: string[];
    hiddenModels: string[];
    defaultModel: string;
    tools: string;
    permissionMode: 'dont_ask' | 'default' | 'accept_edits';
    reasoningEffort: string;
    timeoutMs: number;
    contextWindow: number;
    maxPromptChars: number;
    workspaceRoot: string;
    maxConcurrency: number;
    queueTimeoutMs: number;
    stallWarnMs: number;
    askTool: boolean;
    modelContext: Record<string, number>;
}
interface Run {
    id: string;
    state: string;
    requestedModel: string;
    requestedEffort: string;
    queuedAt: number;
    warning: boolean;
    failure?: string;
    lastProgressAt?: number;
}
interface Status {
    settingsError: boolean;
    config: Config;
    runs: Run[];
    catalogModels: {
        id: string;
        name: string;
    }[];
    modelMessage: string;
}
export declare function validateConfig(value: unknown): string;
export declare function parseStatus(value: unknown): Status;
export declare function apply(ctx: ClientContext): void;
export {};
