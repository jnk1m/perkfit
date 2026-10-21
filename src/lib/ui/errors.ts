import type { ApiError, ApiErrorCode } from '@/lib/types';

export const HTTP_STATUS: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  qloo_unavailable: 503,
  qloo_rate_limited: 429,
  quota_exceeded: 429,
  timeout: 504,
  internal: 500,
};

export function apiError(code: ApiErrorCode, message: string, extra: Partial<ApiError> = {}): ApiError {
  return { code, message, ...extra };
}

export function jsonError(error: ApiError): Response {
  const headers: Record<string, string> = {};
  if (error.retryAfterSec !== undefined) headers['Retry-After'] = String(error.retryAfterSec);
  return Response.json({ error }, { status: HTTP_STATUS[error.code], headers });
}
