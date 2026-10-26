/** Page column shared by every full-width band: max 1200px, 16px gutter on phones and 32px from 640px up. */
export const WRAP = 'mx-auto w-full max-w-[1200px] px-4 sm:px-8';

/**
 * A full-width band with a ruled heading: serif title on the left, a hint on the right.
 * `tone` picks the ground: paper (default) or the bottle field used for What-if.
 * `collapsible` renders the body as a closed <details>; `hint` stays visible next to the title.
 */
export function Section({
  id, title, hint, tone = 'paper', collapsible = false, children,
}: {
  id: string; title: string; hint?: string; tone?: 'paper' | 'bottle';
  collapsible?: boolean; children: React.ReactNode;
}) {
  const bottle = tone === 'bottle';
  const rule = bottle ? 'border-tint-green/50' : 'border-ink';
  const hintColor = bottle ? 'text-on-dark-muted' : 'text-muted';
  const heading = (
    <h2 id={`${id}-h`} className="font-display text-[32px] leading-none sm:text-[44px]">{title}</h2>
  );
  const hintEl = hint && <span className={`text-sm ${hintColor}`}>{hint}</span>;
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={`scroll-mt-4 ${bottle ? 'field-bottle' : ''}`}>
      <div className={`${WRAP} ${bottle ? 'pb-16 pt-16' : 'pb-8 pt-16 sm:pt-[72px]'}`}>
        {collapsible ? (
          <details className="group">
            <summary className={`flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b ${rule} pb-4 [&::-webkit-details-marker]:hidden`}>
              {heading}
              <span className="flex items-baseline gap-3">
                {hintEl}
                <span aria-hidden className="text-lg leading-none group-open:hidden">+</span>
                <span aria-hidden className="hidden text-lg leading-none group-open:inline">&minus;</span>
              </span>
            </summary>
            <div className="mt-6">{children}</div>
          </details>
        ) : (
          <>
            <div className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b ${rule} pb-4`}>
              {heading}
              {hintEl}
            </div>
            <div className="mt-2">{children}</div>
          </>
        )}
      </div>
    </section>
  );
}
