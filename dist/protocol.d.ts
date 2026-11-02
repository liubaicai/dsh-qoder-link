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
