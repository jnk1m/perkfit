import { EXAMPLE_SEGMENTS } from '@/data/candidates';
import { sampleScoresFor } from '@/data/sample/scores';
import type { CompareResponse } from '@/lib/api/types';
import { apiError, jsonError } from '@/lib/ui/errors';
import { MAX_BODY_BYTES, compareRequestSchema, firstIssue } from '@/lib/ui/schemas';
import { clientIp, gateQuota, liveCompare, liveConfigured } from '@/lib/ui/serverSeams';

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
  const parsed = compareRequestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = firstIssue(parsed.error);
    return jsonError(apiError('invalid_request', issue.message, { field: issue.field }));
  }
  const req = parsed.data;

  if (req.mode === 'live') {
    if (!liveConfigured()) {
      return jsonError(apiError('qloo_unavailable', 'Live comparison is not available on this deployment. Switch to sample mode.'));
    }
    const quota = await gateQuota('compare', clientIp(request));
    if (!quota.ok) return jsonError(quota.error);
    const body: CompareResponse = await liveCompare(req);
    return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
  }

  const results: CompareResponse['results'] = [];
  for (const id of req.against) {
    const segment = EXAMPLE_SEGMENTS.find((s) => s.id === id);
    if (!segment) {
      return jsonError(apiError('invalid_request', `Comparison target "${id}" is not available in sample mode`, { field: 'against' }));
    }
    const scores = sampleScoresFor(segment);
    results.push({ segmentId: id, segment, scores, qlooLedger: [] });
  }
  const body: CompareResponse = {
    results,
    meta: { dataSource: 'sample', qlooCalls: 0, cacheHits: 0, noData: 0, noMatch: 0, llm: 'skipped', agentSteps: 0, explanations: { total: 0, passed: 0, discarded: 0 }, elapsedMs: 0 },
  };
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
