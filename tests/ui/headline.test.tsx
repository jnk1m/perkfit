// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Headline } from '@/components/Headline';
import { candidateRows } from '@/lib/ui/viewModel';
import { buildVm, emptyScores, sampleInput } from './helpers';

afterEach(cleanup);

describe('Headline', () => {
  it('shows the engine headline text and the assumption subtitle with the range', () => {
    const vm = buildVm('sample');
    expect(vm.headline.kind).toBe('skip');
    const { getByTestId, container } = render(<Headline vm={vm.headline} />);
    expect(getByTestId('headline-text').textContent).toBe(vm.headline.text);
    expect(vm.headline.text).toMatch(/^Fund these \d+ perks? for \$[\d,]+ of \$[\d,]+\/month$/);
    expect(vm.headline.subtitle).toMatch(/\(range \$[\d,]+ to \$[\d,]+\)\.$/);
    expect(getByTestId('headline-subtitle').textContent).toBe(vm.headline.subtitle);
    expect(container.textContent).toContain('range $');
    // Qloo-ranked claim: solid teal underline. Assumption-based claim: dotted amber underline.
    expect(getByTestId('headline-text').className).toContain('decoration-qloo');
    expect(getByTestId('headline-subtitle').className).toContain('decoration-assume');
    expect(getByTestId('headline-subtitle').className).toContain('decoration-dotted');
  });

  it('shows the engine sentence verbatim when nothing can be judged', () => {
    const vm = buildVm('sample', emptyScores());
    expect(vm.headline.kind).toBe('insufficient');
    const { getByTestId, container } = render(<Headline vm={vm.headline} />);
    expect(getByTestId('headline-text').textContent).toBe(vm.headline.text);
    expect(container.textContent).toContain('Try adding an interest chip');
    expect(container.querySelector('[data-testid="headline-subtitle"]')).toBeNull();
  });

  it('builds a three-line summary and a paste-ready copy text', () => {
    const vm = buildVm('sample');
    expect(vm.summary).not.toBeNull();
    const { lines, copyText } = vm.summary!;
    expect(lines[0]).toMatch(/^For .+, the best \d+-perk bundle costs about \$[\d,]+ of your \$[\d,]+\/month\.$/);
    expect(lines[1]).toMatch(/^Top pick: .+, the highest taste match among .+ \(\d+% rank in category\)\.$/);
    expect(lines[2]).toMatch(/^Skipping \d+ low-fit perks? keeps about \$[\d,]+ from going to perks this segment rates low\.$/);
    expect(copyText.split('\n')).toEqual([...lines, 'Source: PerkFit, Qloo taste data for the segment; costs and usage are assumptions.']);
    expect(vm.headline.skippedLine).toMatch(/^Skipped \d+ low-fit perks?: /);
  });

  it('has no summary when nothing can be judged', () => {
    expect(buildVm('sample', emptyScores()).summary).toBeNull();
  });

  it('adds popularity rank, inclusion reason and sensitivity to the bundle', () => {
    const vm = buildVm('sample');
    for (const r of vm.bundle) {
      if (r.popularityRank !== null) expect(r.popularityRank).toMatch(/^#\d+ of \d+ by popularity \(\d\.\d\d\)$/);
      expect(r.stable).toMatch(/^in \d of 3 usage cases$/);
      expect(r.reason === null).toBe(r.tier === 'high');
    }
    if (vm.sensitivity !== null) expect(vm.sensitivity).toMatch(/^Keeps \d+ of \d+ perks when the tier cuts move by \d+ points either way\.$/);
    expect(vm.holdoutIntro).toMatch(/^Our taste match is a hypothesis\. Check it by hiding each perk from \d+% of members for \d+ weeks\.$/);
  });

  it('writes plain-language compare cards', () => {
    const vm = buildVm('sample');
    expect(vm.cards.popularity.title).toBe('If you chose by popularity');
    expect(vm.cards.popularity.headline).toMatch(/^\d+ of \d+ perks? change; the (two )?rankings (barely|partly|mostly) agree\.$/);
    expect(vm.cards.popularity.lines).toHaveLength(1);
    expect(vm.cards.popularity.lines[0]).toMatch(/^Rank agreement /);
  });

  it('flags edited candidate fields against the catalog defaults', () => {
    const vm = buildVm('sample');
    const input = sampleInput();
    const first = input.candidates[0];
    const rows = candidateRows(input, null, vm.result, { [first.id]: { unitCost: first.unitCost + 1, billing: first.billing, friction: first.friction } });
    expect(rows[0].edited).toEqual({ unitCost: true, billing: false, friction: false });
    expect(rows[1].edited).toEqual({ unitCost: false, billing: false, friction: false });
  });
});
