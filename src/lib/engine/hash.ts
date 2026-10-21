import { DOMAINS } from '@/lib/types';
import type { RunInput } from '@/lib/types';
import type { EngineConfig } from './types';
import { mergeConfig } from './config';
import { cmpStr } from './util';

/** JSON with sorted object keys, so equal values always serialize the same way. */
function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort(cmpStr);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
}

function fnv1a(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Stable 16-hex-char hash of every editable input: segment, candidates (order-independent), budget,
 * members, domain weights and the merged config. Pure JS, so it also runs in the browser.
 */
export function hashInputs(input: RunInput, config?: Partial<EngineConfig>): string {
  const cfg = mergeConfig(config);
  const weights: Record<string, number> = {};
  for (const d of DOMAINS) weights[d] = input.domainWeights?.[d] ?? 1;
  const payload = canon({
    segment: {
      id: input.segment.id,
      age: input.segment.age,
      gender: input.segment.gender ?? null,
      interests: input.segment.interests.map((i) => i.token),
    },
    candidates: [...input.candidates].sort((a, b) => cmpStr(a.id, b.id)),
    budget: input.budget,
    members: input.members,
    weights,
    cfg,
  });
  const hex = (n: number) => n.toString(16).padStart(8, '0');
  return hex(fnv1a(payload, 0x811c9dc5)) + hex(fnv1a(payload, 0x9e3779b1));
}
