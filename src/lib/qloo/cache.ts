import type { Precache } from './precache';
import type { EnvelopeSource, StoredDomainScore } from './types';

/** Process-memory cache of reduced domain scores. Errors are never stored. */
export interface MemoryCache {
  get(key: string): StoredDomainScore | undefined;
  set(key: string, value: StoredDomainScore): void;
  readonly size: number;
}

export function createMemoryCache(maxEntries = 500): MemoryCache {
  const map = new Map<string, StoredDomainScore>();
  return {
    get: (key) => map.get(key),
    set(key, value) {
      if (map.size >= maxEntries) map.delete(map.keys().next().value as string);
      map.set(key, value);
    },
    get size() {
      return map.size;
    },
  };
}

/** Lookup order: memory, then precache. A miss means the caller goes to the network. */
export function lookupCache(
  key: string,
  memory: MemoryCache,
  precache: Precache | null,
): { stored: StoredDomainScore; source: Exclude<EnvelopeSource, 'network'> } | undefined {
  const m = memory.get(key);
  if (m) return { stored: m, source: 'memory' };
  const p = precache?.lookup(key);
  if (p) return { stored: p, source: 'precache' };
  return undefined;
}
