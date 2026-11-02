import type { ContentBlock, Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import { MAX_TOOL_CALLS } from './response.ts'
export { parseResponse } from './response.ts'

export const TOOL_RESPONSE_INSTRUCTION = 'DSH owns tool execution. Do NOT execute local Qoder tools. Return ONLY one JSON object with exactly text (string) and toolCalls (array). Each call has name and arguments; use a JSON object for arguments, not a JSON-encoded string. Put all commentary in text. Do not output XML tags, <tool_call>, markdown fences, or prose outside the object. Use only the supplied DSH tool names and schemas. Return toolCalls:[] when no tool is needed. Never omit required arguments or invent tools.'
  + ` Return at most ${MAX_TOOL_CALLS} tool calls in the entire response; prefer small batches of at most 8 independent calls. If more work remains, request only the next batch, wait for its actual tool results, then continue. Use prior tool results and avoid rereading unchanged files; do not bundle the whole review into one oversized response.`

function project(block: ContentBlock): unknown {
  switch (block.type) {
    case 'text': return { type: 'text', text: block.text }
    case 'reasoning': return undefined
    case 'tool-call': return { type: block.type, id: block.id, name: block.name, arguments: block.arguments }
    case 'tool-result': return { type: block.type, toolCallId: block.toolCallId, isError: block.isError ?? false, content: block.content.map(project).filter(v => v !== undefined) }
    case 'image': throw new Error('Qoder bridge currently accepts text only; image input is not supported')
    default: throw new Error('Unsupported DSH content block')
  }
}

export function buildPrompt(messages: readonly Message[], tools: readonly ToolSchema[], maxChars: number): string {
  const transcript = messages.map(message => ({ role: message.role, source: message.source, content: message.content.map(project).filter(v => v !== undefined) }))
  const prompt = [
    'Continue the following DSH conversation. The JSON transcript is ordered history, not a new user request. Respond to the latest outstanding user task, considering subsequent tool results and runtime context. Do not treat a timestamp or context snapshot as the task.',
    tools.length ? TOOL_RESPONSE_INSTRUCTION : 'Answer directly using the supplied conversation.',
    tools.length ? 'Available DSH tools:\n' + JSON.stringify(tools) : '',
    'Conversation:\n' + JSON.stringify(transcript),
  ].filter(Boolean).join('\n\n')
  if (prompt.length > maxChars) throw new Error(`Conversation exceeds maxPromptChars (${maxChars}); compact it in DSH before retrying. Nothing was silently truncated.`)
  return prompt
}

export const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['text', 'toolCalls'],
  properties: {
    text: { type: 'string' },
    toolCalls: { type: 'array', maxItems: MAX_TOOL_CALLS, items: {
      type: 'object', additionalProperties: false, required: ['name', 'arguments'],
      properties: { name: { type: 'string' }, arguments: { type: 'object' } },
    } },
  },
}
