export function Section({
  id, n, title, aside, collapsible = false, hint, children,
}: {
  id: string; n: number; title: string; aside?: React.ReactNode;
  /** Renders the section as a closed <details>; `hint` stays visible next to the title. */
  collapsible?: boolean; hint?: string; children: React.ReactNode;
}) {
  const heading = (
    <h2 id={`${id}-h`} className="font-display text-xl font-semibold">
      <span className="mr-2 text-sm font-normal tabular-nums text-ink/70">{n}</span>
      {title}
    </h2>
  );
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-t-2 border-ink pt-4">
      {collapsible ? (
        <details className="group">
          <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1">
            {heading}
            {hint && <span className="text-sm text-ink/75">{hint}</span>}
            <span aria-hidden className="ml-auto text-xs text-ink/70 group-open:hidden">Show</span>
            <span aria-hidden className="ml-auto hidden text-xs text-ink/70 group-open:inline">Hide</span>
          </summary>
          <div className="mt-3">{children}</div>
        </details>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            {heading}
            {aside}
          </div>
          {children}
        </>
      )}
    </section>
  );
}
