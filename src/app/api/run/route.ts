import { z } from 'zod';
import type { RunEvent, RunRequest } from '@/lib/api/types';
import { apiError, jsonError } from '@/lib/ui/errors';
import { runSample } from '@/lib/ui/sampleRunner';
import { MAX_BODY_BYTES, firstIssue, runRequestSchema } from '@/lib/ui/schemas';
import { clientIp, gateQuota, liveConfigured, liveRunner } from '@/lib/ui/serverSeams';

export const maxDuration = 60;

const HEADERS = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Accel-Buffering': 'no',
};

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return jsonError(apiError('invalid_request', `Request body is larger than ${MAX_BODY_BYTES} bytes`));
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return jsonError(apiError('invalid_request', 'Request body is not valid JSON'));
  }
  const parsed = runRequestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = firstIssue(parsed.error as z.ZodError);
    return jsonError(apiError('invalid_request', issue.message, { field: issue.field }));
  }
  const req: RunRequest = parsed.data as RunRequest;
  const ip = clientIp(request);

  let runner: (emit: (e: RunEvent) => void, signal: AbortSignal) => Promise<void>;
  if (req.mode === 'sample') {
    runner = (emit, signal) => runSample(req, emit, { signal });
  } else {
    if (!liveConfigured()) {
      return jsonError(apiError('qloo_unavailable', 'Live mode is not available on this deployment. Switch to sample mode.'));
    }
    const quota = await gateQuota('run', ip, { example: req.segment.id !== 'custom', includeLlm: req.includeLlm });
    if (!quota.ok) return jsonError(quota.error);
    const live = liveRunner;
    runner = (emit, signal) => live(req, emit, { signal, ip });
  }

  const abort = new AbortController();
  request.signal.addEventListener('abort', () => abort.abort());
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: RunEvent) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      };
      try {
        await runner(emit, abort.signal);
      } catch (err) {
        // Log the error type only: messages can carry upstream bodies.
        console.error('run stream failed', { mode: req.mode, error: err instanceof Error ? err.name : typeof err });
        emit({ type: 'error', error: apiError('internal', 'The run failed unexpectedly. Try again.') });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by an abort
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, { headers: HEADERS });
}
