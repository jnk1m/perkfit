// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BundleTable } from '@/components/BundleTable';
import { Headline } from '@/components/Headline';
import { WhyRow } from '@/components/WhyRow';
import { buildVm } from './helpers';

afterEach(cleanup);

const BANNED = /\b(will (use|switch|churn|come)|likely to|creditworth|credit score|income)\b/i;

describe('badges', () => {
  it('marks Qloo rows QLOO for live data and SAMPLE for synthetic data; assumptions stay ASSUMPTION', () => {
    for (const source of ['live', 'cache', 'sample'] as const) {
      const vm = buildVm(source);
      const row = vm.bundle[0];
      const { queryAllByText, unmount } = render(<WhyRow rows={row.why} sentence={{ state: 'hidden', text: null }} />);
      const qloo = queryAllByText('QLOO').length;
      const sample = queryAllByText('SAMPLE').length;
      if (source === 'sample') {
        expect(sample).toBeGreaterThan(0);
        expect(qloo).toBe(0);
      } else {
        expect(qloo).toBeGreaterThan(0);
        expect(sample).toBe(0);
      }
      expect(queryAllByText('ASSUMPTION').length).toBeGreaterThan(0);
      expect(queryAllByText('CALC').length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('renders no behavior-prediction or credit wording', () => {
    const vm = buildVm('sample');
    const { container } = render(
      <>
        <Headline vm={vm.headline} />
        <BundleTable rows={vm.bundle} openId={vm.bundle[0].id} onToggle={() => {}} qlooBadge="sample" />
      </>,
    );
    expect(container.textContent).not.toMatch(BANNED);
  });
});
