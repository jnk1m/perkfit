import type { FitTier } from '@/lib/types';
import type { CandidateFacts, Fact } from '@/lib/ledger';

/**
 * Sentence validator for slot templates. Rules (DESIGN decision 6):
 *  V0 schema / missing target   V2 tier echo mismatch   V3 bad slot
 *  V4 digit leak outside slots  V5 source mixing        V7 SAFE_USE words   V9 length
 */
export type RuleId = 'V0' | 'V2' | 'V3' | 'V4' | 'V5' | 'V7' | 'V9';

export const RULE_DESCRIPTIONS: Record<RuleId, string> = {
  V0: 'missing or malformed item for this perk',
  V2: 'tier must repeat the given tier exactly',
  V3: 'use only the listed slots, and include {name}',
  V4: 'no digits, %, $ or number words outside slots',
  V5: 'a sentence with an assumed fact must say "assumed" and must not say "Qloo"; a sentence with a taste-fit slot must not say "assumed"',
  V7: 'avoid prediction, credit, income, causal or individual-level wording',
  V9: 'at most 2 sentences, 40 words and 240 characters',
};

export interface TemplateItem {
  candidateId: string;
  tier: FitTier;
  text: string;
}

export interface ValidationResult {
  ok: boolean;
  rules: RuleId[];
}

const SLOT_RE = /\{([^{}]*)\}/g;
const FIXED_SLOTS = new Set(['name', 'domain', 'tier']);

const NUMBER_WORDS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|percent|half|double|triple|twice)\b/i;

const FORBIDDEN =
  /\b(predict\w*|likely|unlikely|will\s+(use|join|switch|convert|spend|buy)|probab\w*|chance|convert\w*|churn\w*|loyal\w*|credit\w*|income|wealth\w*|afford\w*|financ\w*|eligib\w*|risk\w*|individual\w*|person\b|people who|customers\s+who|caus\w*|driv\w*|because|guarantee\w*|prove\w*)/i;

function stripSlots(text: string): string {
  return text.replace(SLOT_RE, ' ');
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/** Slots used in a piece of text, in order. */
export function slotsOf(text: string): string[] {
  return [...text.matchAll(SLOT_RE)].map((m) => m[1]);
}

/**
 * Validate one candidate's template against its facts.
 * Returns every failed rule, not just the first, so the retry prompt can list them all.
 */
export function validateTemplate(item: TemplateItem | undefined, target: CandidateFacts): ValidationResult {
  const rules: RuleId[] = [];
  if (
    !item ||
    item.candidateId !== target.candidateId ||
    typeof item.text !== 'string' ||
    item.text.trim().length === 0
  ) {
    return { ok: false, rules: ['V0'] };
  }
  const text = item.text;
  const factByKey = new Map<string, Fact>(target.facts.map((f) => [f.key, f]));

  // V2
  if (item.tier !== target.tier) rules.push('V2');

  // V3
  const slots = slotsOf(text);
  const leftover = stripSlots(text);
  const badSlot = slots.some((s) => !FIXED_SLOTS.has(s) && !factByKey.has(s));
  const strayBrace = /[{}]/.test(leftover);
  if (badSlot || strayBrace || !slots.includes('name')) rules.push('V3');

  // V4: digits and number words outside slots
  if (/[\d%$]/.test(leftover) || NUMBER_WORDS.test(leftover)) rules.push('V4');

  // V5: per sentence
  const sentences = splitSentences(text);
  const mixed = sentences.some((sentence) => {
    const ss = slotsOf(sentence);
    const hasAssumedSlot = ss.some((s) => factByKey.get(s)?.assumed === true);
    const hasQlooSlot = ss.includes('tier') || ss.some((s) => {
      const f = factByKey.get(s);
      return f !== undefined && !f.assumed;
    });
    const words = stripSlots(sentence);
    const saysAssumed = /\bassum\w*/i.test(words);
    const saysQloo = /\bqloo\b/i.test(words);
    if (hasAssumedSlot && (!saysAssumed || saysQloo)) return true;
    if (hasQlooSlot && saysAssumed) return true;
    return false;
  });
  if (mixed) rules.push('V5');

  // V7
  if (FORBIDDEN.test(leftover)) rules.push('V7');

  // V9
  if (sentences.length > 2 || wordCount(text) > 40 || text.length > 240) rules.push('V9');

  return { ok: rules.length === 0, rules };
}

/** Replace validated slots with display strings. Throws on a slot that cannot be resolved. */
export function renderTemplate(text: string, target: CandidateFacts, domainLabel: string): string {
  const factByKey = new Map<string, Fact>(target.facts.map((f) => [f.key, f]));
  const out = text.replace(SLOT_RE, (_m, slot: string) => {
    if (slot === 'name') return target.name;
    if (slot === 'domain') return domainLabel;
    if (slot === 'tier') return target.tier;
    const f = factByKey.get(slot);
    if (!f) throw new Error(`renderTemplate: unknown slot {${slot}} for ${target.candidateId}`);
    return f.display;
  });
  return out.replace(/\s+/g, ' ').trim();
}

export interface ValidationStats {
  total: number;
  passedFirst: number;
  repaired: number;
  discarded: number;
  byRule: Partial<Record<RuleId, number>>;
}

export function emptyStats(total: number): ValidationStats {
  return { total, passedFirst: 0, repaired: 0, discarded: 0, byRule: {} };
}

export function countRules(stats: ValidationStats, rules: readonly RuleId[]): void {
  for (const r of rules) stats.byRule[r] = (stats.byRule[r] ?? 0) + 1;
}
