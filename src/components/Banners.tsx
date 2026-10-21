export function Banner({ tone = 'ink', children }: { tone?: 'ink' | 'assume'; children: React.ReactNode }) {
  const style = tone === 'assume' ? 'border-assume text-assume' : 'border-ink text-ink';
  return <div role="status" className={`border-l-4 bg-white/50 px-3 py-2 text-sm ${style}`}>{children}</div>;
}

export const SAMPLE_BANNER = 'SAMPLE MODE. Scores are synthetic demo values, not from Qloo.';
export const STALE_NOTE = 'Edited since the run. AI sentences hidden; ledger values below are current.';
