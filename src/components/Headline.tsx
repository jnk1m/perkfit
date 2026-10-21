import type { ViewModel } from '@/lib/ui/viewModel';
import { Badge } from './Badge';

/** Big text = Qloo's ranking (solid teal underline). Subtitle = our assumptions (dotted amber underline). */
export function Headline({ vm }: { vm: ViewModel['headline'] }) {
  return (
    <div>
      <p
        data-testid="headline-text"
        className="font-display text-3xl font-semibold leading-tight underline decoration-qloo decoration-4 underline-offset-8 md:text-5xl md:underline-offset-[10px]"
      >
        {vm.text}
      </p>
      {vm.subtitle && (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-lg md:text-xl">
          <span data-testid="headline-subtitle" className="underline decoration-assume decoration-2 decoration-dotted underline-offset-4">{vm.subtitle}</span>
          <Badge kind="assumption" />
        </p>
      )}
      {vm.range && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink/85">
          <span>{vm.range}</span>
          <Badge kind="assumption" />
        </p>
      )}
      {vm.hint && <p className="mt-2 text-sm">{vm.hint}</p>}
      <p className="mt-3 text-xs text-ink/75">{vm.definition}</p>
    </div>
  );
}
