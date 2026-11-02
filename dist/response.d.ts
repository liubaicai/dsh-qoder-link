import type { ToolSchema } from '@deepseek-ai/dsh-llm';
export interface NormalizedResponse {
    text: string;
    toolCalls: {
        name: string;
        arguments: string;
    }[];
}
/** Recognizable tool syntax must never silently succeed as plain answer text. */
export declare class ToolResponseFormatError extends Error {
    constructor();
}
/** Broad wire-format compatibility is deliberately anchored at response level.
 * Explanations/code examples are text, not a source of executable fragments. */
export declare function parseResponse(value: unknown, tools: readonly ToolSchema[]): NormalizedResponse;
/** A format retry is not another permissive extraction pass. */
export declare function parseStrictResponse(value: unknown, tools: readonly ToolSchema[]): NormalizedResponse;
