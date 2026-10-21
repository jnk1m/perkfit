import { describe, expect, it } from 'vitest';
import type { CandidateFacts, Fact } from '@/lib/ledger';
import { renderTemplate, validateTemplate } from '@/lib/llm/validator';

const fact = (key: string, assumed: boolean, display: string, field: string): Fact => ({
  key,
  label: key,
  field,
  entryId: `calc.${field}.succession`,
  source: 'calc',
  assumed,
  display,
});

const target: CandidateFacts = {
  candidateId: 'succession',
  name: 'Succession',
  domain: 'tv_show',
  tier: 'high',
  facts: [
    fact('f1', false, '83rd percentile', 'percentile'),
    fact('f2', true, '45%', 'usage_rate'),
    fact('f3', true, '$1,200', 'monthly_cost'),
  ],
};

const GOOD = '{name} sits at {f1} within {domain} for this segment, a {tier} taste fit. The {f3} monthly cost rests on an assumed usage rate of {f2}.';
const item = (text: string, over: Partial<{ tier: 'high' | 'mid' | 'low'; candidateId: string }> = {}) => ({
  candidateId: 'succession',
  tier: 'high' as const,
  text,
  ...over,
});
const rules = (text: string, over = {}) => validateTemplate(item(text, over), target).rules;

describe('validateTemplate', () => {
  it('accepts the reference template and renders slots from the ledger', () => {
    expect(validateTemplate(item(GOOD), target)).toEqual({ ok: true, rules: [] });
    expect(renderTemplate(GOOD, target, 'TV show')).toBe(
      'Succession sits at 83rd percentile within TV show for this segment, a high taste fit. The $1,200 monthly cost rests on an assumed usage rate of 45%.',
    );
  });

  it('T1: a number written outside a slot fails V4', () => {
    expect(rules('{name} ranks at the 83 percentile in {domain}, a {tier} taste fit.')).toContain('V4');
    expect(rules('{name} is a {tier} fit worth $5 per member.')).toContain('V4');
    expect(rules('{name} is a {tier} fit for ten members.')).toContain('V4');
    expect(rules('{name} is a {tier} fit, at 50% of {domain}.')).toContain('V4');
  });

  it('T2: a slot that is not in the fact table fails V3', () => {
    expect(rules('{name} sits at {f9} within {domain}, a {tier} taste fit.')).toContain('V3');
    expect(rules('{name} sits at {} within {domain}, a {tier} taste fit.')).toContain('V3');
    expect(rules('{name} sits at {f1 within {domain}, a {tier} taste fit.')).toContain('V3');
  });

  it('V3: the name slot is required', () => {
    expect(rules('This perk is a {tier} taste fit within {domain}.')).toContain('V3');
  });

  it('T3: an assumed slot without the word assumed fails V5', () => {
    expect(rules('{name} is a {tier} fit. The {f3} monthly cost depends on a usage rate of {f2}.')).toContain('V5');
  });

  it('T4: Qloo wording next to an assumed slot fails V5', () => {
    expect(rules('Qloo shows an assumed usage rate of {f2} for {name}.')).toContain('V5');
  });

  it('T5: a slot that depends on an assumption counts as assumed (carried in the fact flag)', () => {
    // f3 is flagged assumed because the ledger chain reaches an assumption; without "assumed" it fails.
    expect(rules('{name} is a {tier} fit. It costs {f3} each month.')).toContain('V5');
  });

  it('V5: a Qloo-derived slot in a sentence that says assumed fails', () => {
    expect(rules('{name} has an assumed rank of {f1} in {domain}, a {tier} taste fit.')).toContain('V5');
  });

  it('V5 is judged per sentence, so a clean two-sentence text passes', () => {
    expect(rules(GOOD)).toEqual([]);
  });

  it('T6: a tier echo that differs from the ledger fails V2', () => {
    expect(rules(GOOD, { tier: 'low' })).toContain('V2');
  });

  it('T7: missing item, wrong id or empty text fails V0', () => {
    expect(validateTemplate(undefined, target).rules).toEqual(['V0']);
    expect(rules(GOOD, { candidateId: 'other' })).toEqual(['V0']);
    expect(rules('   ')).toEqual(['V0']);
  });

  it('T8: prediction and credit wording fails V7', () => {
    expect(rules('{name} will convert more members in {domain}, a {tier} taste fit.')).toContain('V7');
    expect(rules('{name} is likely a {tier} fit in {domain}.')).toContain('V7');
    expect(rules('{name} suits members with strong income in {domain}, a {tier} fit.')).toContain('V7');
    expect(rules('{name} is a {tier} fit in {domain} because of taste.')).toContain('V7');
    expect(rules('{name} is a {tier} fit for each individual in {domain}.')).toContain('V7');
  });

  it('V9: three sentences, 41 words or 241 characters fail', () => {
    expect(rules('{name} is a {tier} fit. It is in {domain}. It matters.')).toContain('V9');
    expect(rules(`{name} is a {tier} fit in {domain} ${'word '.repeat(40)}`)).toContain('V9');
    expect(rules(`{name} is a {tier} fit in {domain} ${'x'.repeat(240)}`)).toContain('V9');
  });

  it('reports every failed rule, not only the first', () => {
    expect(rules('{name} will convert 83 members. Qloo and assumed words.')).toEqual(expect.arrayContaining(['V4', 'V7']));
  });
});
