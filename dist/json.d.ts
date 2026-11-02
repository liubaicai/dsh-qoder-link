/** Syntax failure may request a fresh response, never repair or execute this one. */
export declare class ResponseJsonSyntaxError extends Error {
    constructor(detail: string);
}
/** Strict JSON with bounded nesting and duplicate-key rejection. No repair/eval. */
export declare function strictJson(input: string): unknown;
