/** Small pure helpers shared by engine modules. */

/** Compare strings by Unicode code point (not UTF-16 unit, not locale). */
export function cmpStr(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done && y.done) return 0;
    if (x.done) return -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0) as number;
    const cy = y.value.codePointAt(0) as number;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

/** Return a sorted copy of ids (code point order). */
export function sortIds(ids: Iterable<string>): string[] {
  return [...ids].sort(cmpStr);
}

/** Round to cents for ledger and display values. */
export const cents = (x: number): number => Math.round(x * 100) / 100;

/** Round to 4 decimals for ratios in the ledger. */
export const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;

/** Sum in the given order. */
export function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}
