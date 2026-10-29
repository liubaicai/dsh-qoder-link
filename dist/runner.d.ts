import { type ChildProcess } from 'node:child_process';
import type { BridgeEvent } from './protocol.ts';
export type { BridgeEvent } from './protocol.ts';
export interface QoderRequest {
    prompt: string;
    systemPrompt?: string;
    cwd: string;
    model?: string;
    effort?: string;
    /** Internal lifecycle notification; never passed to the CLI. */
    onSpawn?: () => void;
    permissionMode?: 'dont_ask' | 'accept_edits' | 'default';
    tools?: string;
    bin?: string;
    /** Inactivity budget, renewed only by validated ACP progress. */
    timeoutMs?: number;
    cliVariant?: 'qodercli' | 'qoderclicn';
    signal?: AbortSignal;
}
/** Resolve npm's Windows launchers without ever invoking cmd.exe or PowerShell. */
export declare function resolveQoderBin(bin?: string, cwd?: string): Promise<{
    command: string;
    args: string[];
}>;
/**
 * Children must run as plain Node. When the DSH host is an Electron app,
 * process.execPath is the GUI binary: spawning it with a script argument would
 * start a second GUI instance that never answers and hangs the request until
 * timeout. ELECTRON_RUN_AS_NODE makes an Electron binary behave as plain Node;
 * a real Node executable simply ignores the variable.
 */
export declare function childEnv(): NodeJS.ProcessEnv;
export declare function killTree(child: ChildProcess): Promise<void>;
/** One fresh native ACP session per complete conversation prompt. */
export declare function runQoder(request: QoderRequest): AsyncGenerator<BridgeEvent>;
