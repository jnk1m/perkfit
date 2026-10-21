import type { RunEvent } from '@/lib/api/types';

/**
 * Parses an NDJSON response body into RunEvents. A line may be split across chunks (and a chunk may split a
 * multi-byte character), so bytes are decoded as a stream and only complete lines are parsed.
 * A malformed line throws with its position instead of being skipped.
 */
export async function* readRunStream(body: ReadableStream<Uint8Array>): AsyncGenerator<RunEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lineNo = 0;

  const parse = (line: string): RunEvent | null => {
    lineNo += 1;
    const trimmed = line.trim();
    if (trimmed === '') return null;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (typeof value !== 'object' || value === null || typeof (value as { type?: unknown }).type !== 'string') {
        throw new Error('missing "type"');
      }
      return value as RunEvent;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Malformed stream line ${lineNo} (${trimmed.length} chars): ${reason}`);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const event = parse(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (event) yield event;
        nl = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    const last = parse(buffer);
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}
