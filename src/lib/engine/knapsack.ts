import { EngineInputError } from './validate';
import { cmpStr } from './util';

export interface KnapItem {
  id: string;
  cost: number;
  /** Any consistent value unit; only differences matter. */
  value: number;
}

export interface KnapResult {
  /** Chosen ids, ascending. */
  ids: string[];
  overBudgetSingle: string[];
  zeroCost: string[];
  budgetBelowUnit: boolean;
}

const TIE = 1e-9;
const MAX_CELLS = 20_000_000;

/**
 * 0/1 knapsack with costs rounded up to `quantUnit`. The real cost sum of the result never exceeds
 * the budget. Ties go to the set with earlier ids (a later item is only taken when it is strictly better).
 */
export function solveKnapsack(items: readonly KnapItem[], budget: number, quantUnit: number): KnapResult {
  const sorted = [...items].sort((a, b) => cmpStr(a.id, b.id));
  const Q = Math.floor(budget / quantUnit + TIE);
  const overBudgetSingle: string[] = [];
  const zeroCost: string[] = [];
  const eligible: { id: string; q: number; v: number }[] = [];
  for (const it of sorted) {
    const q = Math.max(0, Math.ceil(it.cost / quantUnit - TIE));
    if (q > Q) {
      overBudgetSingle.push(it.id);
      continue;
    }
    if (it.cost === 0 && it.value > TIE) zeroCost.push(it.id);
    eligible.push({ id: it.id, q, v: it.value });
  }
  const cap = Math.min(Q, eligible.reduce((s, e) => s + e.q, 0));
  const width = cap + 1;
  if (eligible.length * width > MAX_CELLS) {
    throw new EngineInputError('budget', budget, `is too large for an exact bundle search at quantUnit ${quantUnit}`);
  }
  const dp = new Float64Array(width);
  const keep = new Uint8Array(eligible.length * width);
  eligible.forEach((e, i) => {
    for (let j = cap; j >= e.q; j--) {
      const take = dp[j - e.q] + e.v;
      if (take > dp[j] + TIE) {
        dp[j] = take;
        keep[i * width + j] = 1;
      }
    }
  });
  const ids: string[] = [];
  let j = cap;
  for (let i = eligible.length - 1; i >= 0; i--) {
    if (keep[i * width + j]) {
      ids.push(eligible[i].id);
      j -= eligible[i].q;
    }
  }
  return { ids: ids.reverse(), overBudgetSingle, zeroCost, budgetBelowUnit: Q === 0 };
}
