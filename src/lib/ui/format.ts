/** Small deterministic formatters shared by the view model and the sample runner. */

export function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function usdCents(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function percent(p: number): string {
  return `${Math.round(p * 100)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}
