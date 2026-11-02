import { StringDecoder } from 'node:string_decoder';
/** Incremental UTF-8 NDJSON framing. Final unterminated lines are valid. */
export class NdjsonDecoder {
    decoder = new StringDecoder('utf8');
    pending = '';
    maxLineBytes;
    constructor(maxLineBytes = 8 * 1024 * 1024) { this.maxLineBytes = maxLineBytes; }
    push(chunk) {
        return this.consume(typeof chunk === 'string' ? chunk : this.decoder.write(chunk), false);
    }
    finish() { return this.consume(this.decoder.end(), true); }
    consume(chunk, final) {
        this.pending += chunk;
        const lines = this.pending.split('\n');
        this.pending = final ? '' : lines.pop() ?? '';
        if (Buffer.byteLength(this.pending) > this.maxLineBytes)
            throw new Error('Qoder NDJSON line exceeds limit');
        const values = [];
        for (const line of lines) {
            if (Buffer.byteLength(line) > this.maxLineBytes)
                throw new Error('Qoder NDJSON line exceeds limit');
            if (!line.trim())
                continue;
            try {
                values.push(JSON.parse(line));
            }
            catch {
                throw new Error('Invalid Qoder NDJSON (line content omitted)');
            }
        }
        return values;
    }
}
//# sourceMappingURL=protocol.js.map