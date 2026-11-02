import { StringDecoder } from 'node:string_decoder';

export type BridgeEvent =
  | { type: 'text' | 'reasoning'; delta: string }
  | { type: 'usage'; input: number; output: number; cacheRead: number; cacheWrite: number }
  | { type: 'metadata'; model?: string; totalCredits?: number; totalCostUsd?: number }
  | { type: 'tool-start'; id: string; name: string; input?: unknown }
  | { type: 'tool-end'; id: string; name?: string; output?: unknown; isError?: boolean }
  | { type: 'result'; sessionId?: string; text: string; structuredOutput?: unknown };

/** Incremental UTF-8 NDJSON framing. Final unterminated lines are valid. */
export class NdjsonDecoder {
  private decoder = new StringDecoder('utf8');
  private pending = '';
  private readonly maxLineBytes: number;
  constructor(maxLineBytes = 8 * 1024 * 1024) { this.maxLineBytes = maxLineBytes; }
  push(chunk: Buffer | string): unknown[] {
    return this.consume(typeof chunk === 'string' ? chunk : this.decoder.write(chunk), false);
  }
  finish(): unknown[] { return this.consume(this.decoder.end(), true); }
  private consume(chunk: string, final: boolean): unknown[] {
    this.pending += chunk;
    const lines = this.pending.split('\n');
    this.pending = final ? '' : lines.pop() ?? '';
    if (Buffer.byteLength(this.pending) > this.maxLineBytes) throw new Error('Qoder NDJSON line exceeds limit');
    const values: unknown[] = [];
    for (const line of lines) {
      if (Buffer.byteLength(line) > this.maxLineBytes) throw new Error('Qoder NDJSON line exceeds limit');
      if (!line.trim()) continue;
      try { values.push(JSON.parse(line)); }
      catch { throw new Error('Invalid Qoder NDJSON (line content omitted)'); }
    }
    return values;
  }
}
