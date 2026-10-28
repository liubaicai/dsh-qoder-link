import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SettingsStore } from './settings.ts';
export interface WebServerLike {
    register(route: {
        kind: 'exact';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void;
    }): unknown;
}
/** Host authentication remains authoritative; additionally reject browser cross-origin requests. */
export declare function registerSettingsRoutes(server: WebServerLike, store: SettingsStore, notify: () => void, readRuns?: () => unknown[]): () => void;
