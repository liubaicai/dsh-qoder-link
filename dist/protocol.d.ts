export type BridgeEvent = {
    type: 'text' | 'reasoning';
    delta: string;
} | {
    type: 'usage';
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
} | {
    type: 'metadata';
    model?: string;
    totalCredits?: number;
    totalCostUsd?: number;
} | {
    type: 'tool-start';
    id: string;
    name: string;
    input?: unknown;
} | {
    type: 'tool-end';
    id: string;
    name?: string;
    output?: unknown;
    isError?: boolean;
} | {
    type: 'result';
    sessionId?: string;
    text: string;
    structuredOutput?: unknown;
};
/** Incremental UTF-8 NDJSON framing. Final unterminated lines are valid. */
export declare class NdjsonDecoder {
    private decoder;
    private pending;
    private readonly maxLineBytes;
    constructor(maxLineBytes?: number);
    push(chunk: Buffer | string): unknown[];
    finish(): unknown[];
    private consume;
}
/** Stateful Claude-compatible Qoder stream-json adapter. Usage events are cumulative snapshots. */
export declare class QoderProtocol {
    private sessionId?;
    private activeId;
    private sequence;
    private streamed;
    private usages;
    private tools;
    private endedTools;
    private assistantIds;
    private output;
    private lastUsage;
    private done;
    get hasResult(): boolean;
    accept(value: unknown): BridgeEvent[];
    /**
     * Compatibility safeguard inherited from the reference bridge: some CLI
     * failures echo an HTTP status with a reason phrase instead of a result.
     * Numeric answers alone are ordinary output. Fail fast only on status lines
     * and omit the supplied status text, which could contain credential material.
     */
    private rejectEchoedHttpError;
    private delta;
    private startTool;
    private emitMetadata;
    private parseUsage;
    private updateUsage;
    private emitUsage;
}
