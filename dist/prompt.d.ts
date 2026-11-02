import type { Message, ToolSchema } from '@deepseek-ai/dsh-llm';
export { parseResponse } from './response.ts';
export declare const TOOL_RESPONSE_INSTRUCTION = "DSH owns tool execution. Do NOT execute local Qoder tools. Return ONLY one JSON object with exactly text (string) and toolCalls (array). Each call has name and arguments; use a JSON object for arguments, not a JSON-encoded string. Put all commentary in text. Do not output XML tags, <tool_call>, markdown fences, or prose outside the object. Use only the supplied DSH tool names and schemas. Return toolCalls:[] when no tool is needed. Never omit required arguments or invent tools.";
export declare function buildPrompt(messages: readonly Message[], tools: readonly ToolSchema[], maxChars: number): string;
export declare const RESPONSE_SCHEMA: Record<string, unknown>;
