import type { AskState } from '@/lib/ui/reducer';

export function AskUser({ ask, onAnswer }: { ask: AskState; onAnswer: (questionId: string, token: string) => void }) {
  return (
    <div role="group" aria-label="Clarifying question" className="border-2 border-ink bg-white/60 p-3 text-sm">
      <p className="font-semibold">{ask.question}</p>
      <p className="text-ink/80">The agent found more than one match and will not guess. Pick one to continue.</p>
      <ul className="mt-2 flex flex-col gap-2 sm:flex-row">
        {ask.options.map((o) => (
          <li key={o.token}>
            <button type="button" onClick={() => onAnswer(ask.questionId, o.token)} className="h-11 w-full border border-ink px-3 text-left sm:w-auto md:h-auto md:py-1.5">
              <span className="font-semibold">{o.name}</span>
              {o.hint && <span className="ml-2 text-ink/75">{o.hint}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
