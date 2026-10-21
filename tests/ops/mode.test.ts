import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { parseEnv } from '@/lib/ops/env';
import { getClientIp } from '@/lib/ops/ip';
import { resolveMode } from '@/lib/ops/mode';

describe('resolveMode', () => {
  it('is sample when forced, even with a key', () => {
    expect(resolveMode({ PERKFIT_MODE: 'sample', QLOO_API_KEY: 'abc12345' })).toBe('sample');
  });
  it('is live with a key and no override', () => {
    expect(resolveMode({ QLOO_API_KEY: 'abc12345' })).toBe('live');
    expect(resolveMode({ PERKFIT_MODE: 'live', QLOO_API_KEY: 'abc12345' })).toBe('live');
  });
  it('is sample without a key', () => {
    expect(resolveMode({})).toBe('sample');
    expect(resolveMode({ PERKFIT_MODE: 'live', QLOO_API_KEY: '' })).toBe('sample');
  });
});

describe('parseEnv', () => {
  it('treats empty strings as unset and applies defaults', () => {
    const env = parseEnv({ QLOO_API_KEY: '', PERKFIT_MODE: '', PERKFIT_LLM_MODEL: '' });
    expect(env.QLOO_API_KEY).toBeUndefined();
    expect(env.QLOO_BASE_URL).toBe('https://hackathon.api.qloo.com');
    expect(env.PERKFIT_LLM_MODEL).toBe('claude-opus-5-5');
  });
  it('names the bad variable without echoing its value', () => {
    const bad = 'not-a-url-secret-value';
    expect(() => parseEnv({ QLOO_BASE_URL: bad })).toThrow(/QLOO_BASE_URL/);
    try {
      parseEnv({ QLOO_BASE_URL: bad });
    } catch (e) {
      expect(String(e)).not.toContain(bad);
    }
  });
  it('rejects an unknown mode', () => {
    expect(() => parseEnv({ PERKFIT_MODE: 'demo' })).toThrow(/PERKFIT_MODE/);
  });
});

describe('getClientIp', () => {
  const h = (m: Record<string, string>) => ({ get: (k: string) => m[k] ?? null });
  it('uses the first forwarded address', () => {
    expect(getClientIp(h({ 'x-forwarded-for': ' 203.0.113.9 , 10.0.0.1' }))).toBe('203.0.113.9');
  });
  it('falls back to x-real-ip, then unknown', () => {
    expect(getClientIp(h({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(getClientIp(h({}))).toBe('unknown');
  });
});
