import { type PluginConfig } from './config.ts';
export declare const modelFailure = "\u6A21\u578B\u5217\u8868\u83B7\u53D6\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5 CLI \u5B89\u88C5\u3001\u767B\u5F55\u4E0E\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002";
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
