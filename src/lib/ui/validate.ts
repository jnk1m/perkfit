/** Range checks for editable cells. Out-of-range input is rejected with a reason; values are never silently clamped. */

export type EditKind = 'unitCost' | 'friction' | 'budget' | 'members' | 'weight' | 'usage';
export type Parsed = { ok: true; value: number } | { ok: false; reason: string };

const RULES: Record<EditKind, { min: number; max: number; integer?: boolean; exclusiveMin?: boolean; label: string }> = {
  unitCost: { min: 0, max: 10_000, label: 'Unit cost' },
  friction: { min: 0.1, max: 2, label: 'Friction' },
  budget: { min: 0, max: 1e9, exclusiveMin: true, label: 'Budget' },
  members: { min: 1, max: 1e8, integer: true, label: 'Members' },
  weight: { min: 0, max: 2, label: 'Weight' },
  usage: { min: 0, max: 1, label: 'Usage' },
};

export function parseEdit(kind: EditKind, text: string): Parsed {
  const rule = RULES[kind];
  const cleaned = text.trim().replace(/[$,\s]/g, '');
  if (cleaned === '') return { ok: false, reason: `${rule.label}: enter a number` };
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return { ok: false, reason: `${rule.label}: "${text.trim()}" is not a number` };
  if (rule.integer && !Number.isInteger(value)) return { ok: false, reason: `${rule.label}: must be a whole number` };
  if (rule.exclusiveMin ? value <= rule.min : value < rule.min) {
    return { ok: false, reason: `${rule.label}: must be ${rule.exclusiveMin ? 'above' : 'at least'} ${rule.min}` };
  }
  if (value > rule.max) return { ok: false, reason: `${rule.label}: must be at most ${rule.max}` };
  return { ok: true, value };
}
