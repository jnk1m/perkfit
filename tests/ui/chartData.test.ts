import { describe, expect, it } from 'vitest';
import { sampleScoresFor } from '@/data/sample/scores';
import { DEFAULTS, runEngine } from '@/lib/ui/engine';
import { chartPoints } from '@/lib/ui/chartData';
import { emptyScores, sampleInput } from './helpers';

describe('chartPoints', () => {
  const input = sampleInput();
  const result = runEngine(input, sampleScoresFor(input.segment), DEFAULTS);
  const points = chartPoints(result);

  it('has one point per scored perk, all with a 0..1 percentile', () => {
    expect(points).toHaveLength(result.perks.length);
    expect(new Set(points.map((p) => p.id)).size).toBe(points.length);
    for (const p of points) {
      expect(p.percentile).toBeGreaterThanOrEqual(0);
      expect(p.percentile).toBeLessThanOrEqual(1);
    }
  });

  it('marks exactly the base bundle as inBundle', () => {
    const ids = points.filter((p) => p.inBundle).map((p) => p.id).sort();
    expect(ids).toEqual([...result.bundle.byScenario.base.perkIds].sort());
    expect(ids.length).toBeGreaterThan(0);
  });

  it('carries popularity and tier through unchanged', () => {
    for (const p of result.perks) {
      const pt = points.find((x) => x.id === p.candidateId)!;
      expect(pt.popularity).toBe(p.popularity);
      expect(pt.tier).toBe(p.tier);
    }
  });

  it('is empty when nothing could be judged', () => {
    expect(chartPoints(runEngine(input, emptyScores(), DEFAULTS))).toEqual([]);
  });
});
