import type { SearchResponse } from '@/lib/api/types';
import { apiError, jsonError } from '@/lib/ui/errors';
import { firstIssue, searchQuerySchema } from '@/lib/ui/schemas';
import { clientIp, gateQuota, searchEntities } from '@/lib/ui/serverSeams';

export async function GET(request: Request): Promise<Response> {
  const parsed = searchQuerySchema.safeParse({ q: new URL(request.url).searchParams.get('q') ?? '' });
  if (!parsed.success) {
    const issue = firstIssue(parsed.error);
    return jsonError(apiError('invalid_request', issue.message, { field: 'q' }));
  }
  const quota = await gateQuota('search', clientIp(request));
  if (!quota.ok) return jsonError(quota.error);
  const results = (await searchEntities(parsed.data.q)).slice(0, 5);
  const body: SearchResponse = { results };
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
