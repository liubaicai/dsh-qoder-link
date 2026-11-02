export { parseResponse } from "./response.js";
export const TOOL_RESPONSE_INSTRUCTION = 'DSH owns tool execution. Do NOT execute local Qoder tools. Return ONLY one JSON object with exactly text (string) and toolCalls (array). Each call has name and arguments; use a JSON object for arguments, not a JSON-encoded string. Put all commentary in text. Do not output XML tags, <tool_call>, markdown fences, or prose outside the object. Use only the supplied DSH tool names and schemas. Return toolCalls:[] when no tool is needed. Never omit required arguments or invent tools.';
function project(block) {
    switch (block.type) {
        case 'text': return { type: 'text', text: block.text };
        case 'reasoning': return undefined;
        case 'tool-call': return { type: block.type, id: block.id, name: block.name, arguments: block.arguments };
        case 'tool-result': return { type: block.type, toolCallId: block.toolCallId, isError: block.isError ?? false, content: block.content.map(project).filter(v => v !== undefined) };
        case 'image': throw new Error('Qoder bridge currently accepts text only; image input is not supported');
        default: throw new Error('Unsupported DSH content block');
    }
}
export function buildPrompt(messages, tools, maxChars) {
    const transcript = messages.map(message => ({ role: message.role, source: message.source, content: message.content.map(project).filter(v => v !== undefined) }));
    const prompt = [
        'Continue the following DSH conversation. The JSON transcript is ordered history, not a new user request. Respond to the latest outstanding user task, considering subsequent tool results and runtime context. Do not treat a timestamp or context snapshot as the task.',
        tools.length ? TOOL_RESPONSE_INSTRUCTION : 'Answer directly using the supplied conversation.',
        tools.length ? 'Available DSH tools:\n' + JSON.stringify(tools) : '',
        'Conversation:\n' + JSON.stringify(transcript),
    ].filter(Boolean).join('\n\n');
    if (prompt.length > maxChars)
        throw new Error(`Conversation exceeds maxPromptChars (${maxChars}); compact it in DSH before retrying. Nothing was silently truncated.`);
    return prompt;
}
export const RESPONSE_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['text', 'toolCalls'],
    properties: {
        text: { type: 'string' },
        toolCalls: { type: 'array', maxItems: 32, items: {
                type: 'object', additionalProperties: false, required: ['name', 'arguments'],
                properties: { name: { type: 'string' }, arguments: { type: 'object' } },
            } },
    },
};
//# sourceMappingURL=prompt.js.map