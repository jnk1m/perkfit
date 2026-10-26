import type { ViewModel } from '@/lib/ui/viewModel';
import { Badge } from './Badge';

/** The first dollar amount is the money the bundle spends: set it in sand italic. The text itself is unchanged. */
function withAmount(text: string) {
  const m = /\$[\d,]+/.exec(text);
  if (!m) return text;
  return (
    <>
      {text.slice(0, m.index)}
      <em className="text-tint-sand">{m[0]}</em>
      {text.slice(m.index + m[0].length)}
    </>
  );
}

/** On the ink result field. Big serif text = Qloo's ranking (solid green underline). Subtitle = our assumptions (dotted sand underline). */
export function Headline({ vm }: { vm: ViewModel['headline'] }) {
  const skipped = vm.skippedLine ? /^([^:]+:)([\s\S]*)$/.exec(vm.skippedLine) : null;
  return (
    <div>
      <p
        data-testid="headline-text"
        className="max-w-[1000px] font-display text-[44px] font-normal leading-[0.98] tracking-[-0.015em] underline decoration-qloo decoration-tint-green! decoration-[3px] underline-offset-[10px] md:text-[92px]"
      >
        {withAmount(vm.text)}
      </p>
      {vm.subtitle && (
        <p className="mt-7 flex max-w-[860px] flex-wrap items-center gap-x-3 gap-y-2 font-display text-[21px] leading-[1.3] text-on-dark md:text-[28px]">
          <span data-testid="headline-subtitle" className="underline decoration-assume decoration-tint-sand! decoration-2 decoration-dotted underline-offset-[6px]">{vm.subtitle}</span>
          <Badge kind="assumption" onInk />
        </p>
      )}
      {vm.skippedLine && (
        <p data-testid="headline-skipped" className="mt-8 max-w-[900px] border-t border-on-dark/20 pt-4 text-[15px] text-on-dark-muted">
          {skipped ? <><b className="font-semibold text-tint-sand">{skipped[1]}</b>{skipped[2]}</> : vm.skippedLine}
        </p>
      )}
      {vm.hint && <p className="mt-3 text-[15px] text-on-dark">{vm.hint}</p>}
      <p className="mt-3 text-[13px] text-on-dark-muted">{vm.definition}</p>
    </div>
  );
}
