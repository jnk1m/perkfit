import type { AgentTraceStep } from '@/lib/types';

export function AgentTrace({ steps }: { steps: AgentTraceStep[] | undefined }) {
  return (
    <details className="border-t border-ink/30 pt-3 text-sm">
      <summary className="cursor-pointer font-semibold">Agent trace</summary>
      {steps && steps.length > 0 ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Steps the agent took in this run</caption>
            <thead>
              <tr className="border-b border-ink/40">
                <th scope="col" className="py-1 pr-2">Step</th><th scope="col" className="pr-2">Tool</th><th scope="col" className="pr-2">Result</th>
                <th scope="col" className="pr-2 text-right">ms</th><th scope="col" className="pr-2 text-right">Qloo calls</th><th scope="col">Summary</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {steps.map((s) => (
                <tr key={s.step} className="border-b border-ink/15">
                  <td className="py-1 pr-2">{s.step}</td><td className="pr-2">{s.tool}</td><td className="pr-2">{s.ok ? 'ok' : 'failed'}</td>
                  <td className="pr-2 text-right">{s.ms}</td><td className="pr-2 text-right">{s.qlooCalls}</td><td>{s.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-ink/80">No agent steps in this run. Sample mode runs no agent.</p>
      )}
    </details>
  );
}
