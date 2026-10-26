import type { ChartPoint } from '@/lib/ui/chartData';
import { TwoRulers } from './TwoRulers';
import { WRAP } from './Section';

/** Before the first run: the question, and the "two rulers" chart from the cached example when the server has it. */
export function Hero({ points }: { points: ChartPoint[] | null }) {
  return (
    <section aria-labelledby="result-h">
      <div className={`${WRAP} pb-8 pt-16 sm:pt-[72px]`}>
        <p className="label mb-6 font-semibold text-sienna">Example A, cached</p>
        <h2 id="result-h" className="max-w-[1000px] font-display text-[44px] leading-[1] tracking-[-0.015em] sm:text-[72px]">
          Which perks should this audience get?
        </h2>
        <p className="mt-6 max-w-[720px] text-[15px] text-muted">
          Pick partner perks for a customer segment by taste, inside a budget. Qloo ranks how well each perk fits the segment; costs and usage are editable assumptions.
        </p>
        {points && points.length > 0 && (
          <div className="mt-12">
            <TwoRulers points={points} caption="Same 20 perks, two rulers: popularity cannot tell them apart, taste match can." />
          </div>
        )}
      </div>
    </section>
  );
}
