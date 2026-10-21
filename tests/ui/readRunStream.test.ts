import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@/lib/api/types';
import { readRunStream } from '@/lib/ui/readRunStream';

const EVENTS: RunEvent[] = [
  { type: 'stage', stage: 'resolve', status: 'start' },
  { type: 'llm_alone', status: 'ok', picks: ['café', 'テスト'], dropped: [] },
  { type: 'error', error: { code: 'timeout', message: 'café ✓' } },
];
const PAYLOAD = new TextEncoder().encode(EVENTS.map((e) => JSON.stringify(e)).join('\n') + '\n');

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of readRunStream(body)) out.push(e);
  return out;
}

describe('readRunStream', () => {
  it('returns events in order when a line is split across chunks, at every possible cut point', async () => {
    for (let cut = 1; cut < PAYLOAD.length; cut++) {
      const events = await collect(streamOf([PAYLOAD.slice(0, cut), PAYLOAD.slice(cut)]));
      expect(events).toEqual(EVENTS);
    }
  });

  it('handles one byte per chunk and a missing final newline', async () => {
    const trimmed = PAYLOAD.slice(0, PAYLOAD.length - 1);
    const chunks = Array.from(trimmed, (b) => new Uint8Array([b]));
    expect(await collect(streamOf(chunks))).toEqual(EVENTS);
  });

  it('throws with the line number instead of skipping a malformed line', async () => {
    const bad = new TextEncoder().encode('{"type":"stage","stage":"resolve","status":"start"}\nnot json\n');
    await expect(collect(streamOf([bad]))).rejects.toThrow(/line 2/);
  });
});
