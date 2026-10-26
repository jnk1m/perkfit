export function Banner({ tone = 'ink', children }: { tone?: 'ink' | 'assume'; children: React.ReactNode }) {
  const style = tone === 'assume' ? 'border-l-sienna bg-sand' : 'border-l-ink bg-paper-2';
  return <div role="status" className={`border-l-4 px-4 py-3 text-sm text-ink ${style}`}>{children}</div>;
}

export const SAMPLE_BANNER = 'SAMPLE MODE. Scores are synthetic demo values, not from Qloo.';
export const STALE_NOTE = 'Edited since the run. AI sentences hidden; ledger values below are current.';
