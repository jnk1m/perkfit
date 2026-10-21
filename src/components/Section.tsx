export function Section({ id, n, title, aside, children }: { id: string; n: number; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-t-2 border-ink pt-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-h`} className="font-display text-xl font-semibold">
          <span className="mr-2 text-sm font-normal tabular-nums text-ink/70">{n}</span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
