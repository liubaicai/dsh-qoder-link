import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SettingsStore } from './settings.ts';
import type { PluginConfig } from './config.ts';
export interface WebServerLike {
    register(route: {
        kind: 'exact';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void;
    }): unknown;
}
export interface ModelCatalog {
    models: {
        id: string;
        name: string;
    }[];
    message: string;
}
export type RefreshModels = (config: PluginConfig) => Promise<ModelCatalog>;
/** GET is passive; discovery is explicit and results are bound to the CLI configuration epoch. */
export declare function registerSettingsRoutes(server: WebServerLike, store: SettingsStore, notify: () => void, readRuns?: () => unknown[], refreshModels?: RefreshModels): () => void;
