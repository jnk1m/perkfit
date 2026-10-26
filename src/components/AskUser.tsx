import type { AskState } from '@/lib/ui/reducer';

export function AskUser({ ask, onAnswer }: { ask: AskState; onAnswer: (questionId: string, token: string) => void }) {
  return (
    <div role="group" aria-label="Clarifying question" className="border-l-4 border-l-sienna bg-sand p-4 text-sm">
      <p className="font-semibold">{ask.question}</p>
      <p className="text-ink/80">The agent found more than one match and will not guess. Pick one to continue.</p>
      <ul className="mt-3 flex flex-col gap-2 sm:flex-row">
        {ask.options.map((o) => (
          <li key={o.token}>
            <button type="button" onClick={() => onAnswer(ask.questionId, o.token)} className="min-h-11 w-full border border-ink px-4 text-left transition-colors hover:bg-ink hover:text-paper active:bg-ink-2 active:text-paper sm:w-auto md:min-h-9">
              <span className="font-semibold">{o.name}</span>
              {o.hint && <span className="ml-2 opacity-75">{o.hint}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
