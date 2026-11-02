import { type PluginConfig } from './config.ts';
export declare const modelFailure = "\u6A21\u578B\u5217\u8868\u83B7\u53D6\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5 CLI \u5B89\u88C5\u3001\u767B\u5F55\u4E0E\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002";
export declare const modelFailures: {
    readonly unavailable: "无法启动所选 CLI，请检查安装与自定义路径。";
    readonly timeout: "获取模型列表超时，请稍后重试并检查网络。";
    readonly exit: "CLI 未能获取模型列表，请检查登录与网络后重试。";
    readonly output: "CLI 模型列表输出超出限制，请检查 CLI 版本。";
    readonly format: "CLI 模型列表格式无法识别，请检查 CLI 版本。";
};
export declare class ModelDiscoveryError extends Error {
    readonly kind: keyof typeof modelFailures;
    constructor(kind: keyof typeof modelFailures);
}
/** Only fixed categories may cross the HTTP/UI boundary, never Error.message. */
export declare function modelFailureMessage(error: unknown): string;
/** Parse only the observed official --list-models table, never arbitrary diagnostics. */
export declare function parseModels(output: string): {
    id: string;
    name: string;
}[];
/** No prompt, auth inspection, shell, or workspace settings: CLI owns authentication. */
export declare function discoverModels(config: PluginConfig, timeoutMs?: number): Promise<{
    models: {
        id: string;
        name: string;
    }[];
    message: string;
}>;
