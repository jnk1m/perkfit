import type { LedgerEntry, Scenario } from '@/lib/types';

export type NewLedgerEntry = Omit<LedgerEntry, 'seq'> & { seq?: number };

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/**
 * Append-only evidence ledger for one run. Duplicate ids throw. `seq` is the creation order (1..N).
 */
export class Ledger {
  private readonly entries: LedgerEntry[] = [];
  private readonly byId = new Map<string, LedgerEntry>();

  add(entry: NewLedgerEntry): LedgerEntry {
    if (this.byId.has(entry.id)) {
      throw new LedgerError(`duplicate ledger id: ${entry.id}`);
    }
    if (entry.source === 'calc' && (!entry.dependsOn || entry.dependsOn.length === 0)) {
      throw new LedgerError(`calc entry requires dependsOn: ${entry.id}`);
    }
    const { seq: _ignored, ...rest } = entry;
    void _ignored;
    const stored: LedgerEntry = { ...rest, seq: this.entries.length + 1 };
    this.entries.push(stored);
    this.byId.set(stored.id, stored);
    return stored;
  }

  get(id: string): LedgerEntry | undefined {
    return this.byId.get(id);
  }

  /** Entries about one candidate, in creation order. */
  forCandidate(candidateId: string): LedgerEntry[] {
    return this.entries.filter((e) => e.candidateId === candidateId);
  }

  /** Entries that are not about a single candidate. */
  forRun(): LedgerEntry[] {
    return this.entries.filter((e) => e.candidateId === undefined);
  }

  /**
   * Look an entry up by what it says, not by how its id is spelled.
   * `scenario` omitted matches an entry without a scenario.
   */
  find(candidateId: string, field: string, scenario?: Scenario): LedgerEntry | undefined {
    return this.entries.find(
      (e) => e.candidateId === candidateId && e.field === field && e.scenario === scenario,
    );
  }

  /** True when the entry is an assumption or any entry it depends on (recursively) is. */
  isAssumed(id: string): boolean {
    return this.assumedWalk(id, new Set());
  }

  private assumedWalk(id: string, seen: Set<string>): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    const entry = this.byId.get(id);
    if (!entry) return false;
    if (entry.source === 'assumption') return true;
    return (entry.dependsOn ?? []).some((dep) => this.assumedWalk(dep, seen));
  }

  get size(): number {
    return this.entries.length;
  }

  toJSON(): LedgerEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  /**
   * Build a ledger from the Qloo entries (first) and the engine entries (after them).
   * Each group keeps its own order; `seq` is reassigned so the offset is the Qloo group size.
   */
  static merge(qlooEntries: readonly LedgerEntry[], engineEntries: readonly LedgerEntry[]): Ledger {
    const ledger = new Ledger();
    for (const e of [...qlooEntries].sort((a, b) => a.seq - b.seq)) ledger.add(e);
    for (const e of [...engineEntries].sort((a, b) => a.seq - b.seq)) ledger.add(e);
    return ledger;
  }
}
