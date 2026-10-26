import type { AgentTraceStep } from '@/lib/types';

export function AgentTrace({ steps, summary }: { steps: AgentTraceStep[] | undefined; summary?: string }) {
  return (
    <details className="group border-y border-ink text-sm">
      <summary className="label flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold [&::-webkit-details-marker]:hidden">
        <span>Agent trace{summary && <span className="ml-3 font-normal normal-case tracking-normal text-muted">{summary}</span>}</span>
        <span aria-hidden><span className="group-open:hidden">Show +</span><span className="hidden group-open:inline">Hide −</span></span>
      </summary>
      {steps && steps.length > 0 ? (
        <div className="overflow-x-auto pb-4">
          <table className="w-full min-w-[32rem] text-left text-[13px]">
            <caption className="sr-only">Steps the agent took in this run</caption>
            <thead>
              <tr className="border-b border-ink text-[11px] uppercase tracking-[0.12em] text-sienna">
                <th scope="col" className="py-2 pr-3 font-semibold">Step</th><th scope="col" className="pr-3 font-semibold">Tool</th><th scope="col" className="pr-3 font-semibold">Result</th>
                <th scope="col" className="pr-3 text-right font-semibold">ms</th><th scope="col" className="pr-3 text-right font-semibold">Qloo calls</th><th scope="col" className="font-semibold">Summary</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {steps.map((s) => (
                <tr key={s.step} className="border-b border-ink/30">
                  <td className="py-2 pr-3">{s.step}</td><td className="pr-3">{s.tool}</td><td className="pr-3">{s.ok ? 'ok' : 'failed'}</td>
                  <td className="pr-3 text-right">{s.ms}</td><td className="pr-3 text-right">{s.qlooCalls}</td><td>{s.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="pb-4 text-muted">No agent steps in this run. Sample mode runs no agent.</p>
      )}
    </details>
  );
}
