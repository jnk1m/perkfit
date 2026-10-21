// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Headline } from '@/components/Headline';
import { buildVm, emptyScores } from './helpers';

afterEach(cleanup);

describe('Headline', () => {
  it('shows the engine headline text, the assumption subtitle and the range', () => {
    const vm = buildVm('sample');
    expect(vm.headline.kind).toBe('skip');
    const { getByTestId, container } = render(<Headline vm={vm.headline} />);
    expect(getByTestId('headline-text').textContent).toBe(vm.headline.text);
    expect(vm.headline.text).toMatch(/^Skip \d+ low-fit perks?$/);
    expect(getByTestId('headline-subtitle').textContent).toBe(vm.headline.subtitle);
    expect(container.textContent).toContain('pessimistic to optimistic');
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
});
