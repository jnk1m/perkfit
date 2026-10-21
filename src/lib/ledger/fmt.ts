/**
 * Display formats for ledger values. The explain step never writes numbers itself;
 * the validator-approved slots are replaced with these strings.
 */

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function usd(value: number): string {
  const rounded = Math.round(value);
  return `$${rounded.toLocaleString('en-US')}`;
}

type Formatter = (value: number | string) => string;

const num = (f: (n: number) => string): Formatter => (v) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`fmt: expected a finite number, got ${String(v)}`);
  return f(n);
};

/** Keyed by ledger `field`. */
export const FMT: Record<string, Formatter> = {
  percentile: num((p) => `${ordinal(Math.round(p * 100))} percentile`),
  usage_rate: num((u) => `${Math.round(u * 100)}%`),
  monthly_cost: num(usd),
  fit_tier: (v) => String(v),
  stability: num((n) => `${n} of 3 scenarios`),
};

export function fmtValue(field: string, value: number | string): string {
  const f = FMT[field];
  if (f) return f(value);
  return typeof value === 'number' ? String(Math.round(value * 100) / 100) : value;
}

export const DOMAIN_LABEL = {
  place: 'place',
  tv_show: 'TV show',
  brand: 'brand',
  book: 'book',
} as const;
