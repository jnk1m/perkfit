'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChartPoint } from '@/lib/ui/chartData';

/**
 * "Same perks, two rulers": every candidate sits on a popularity ruler (bunched at the right edge) and is
 * connected to its place on the taste-match ruler (spread from Low to High). Moves once, 1.1 s, when first seen.
 */

const DURATION_MS = 1100;

interface Palette { text: string; sub: string; axis: string; inBundle: string; low: string; other: string; otherLine: string; halo: string }

const PAPER: Palette = {
  text: '#0e1a2b', sub: '#5a6270', axis: '#0e1a2b', inBundle: '#1f4a3a',
  low: '#8a4b2a', other: '#a9a18d', otherLine: '#b9b19d', halo: '#f4f0e7',
};
const INK: Palette = {
  text: '#f4f0e7', sub: '#b8bcc4', axis: '#b8bcc4', inBundle: '#7fb59b',
  low: '#d49a6a', other: '#7d8798', otherLine: '#56627a', halo: '#0e1a2b',
};

interface Layout { w: number; h: number; x0: number; x1: number; top: number; bot: number; font: number; maxName: number }
const WIDE: Layout = { w: 960, h: 340, x0: 14, x1: 946, top: 92, bot: 270, font: 12, maxName: 40 };
const COMPACT: Layout = { w: 340, h: 330, x0: 12, x1: 328, top: 92, bot: 256, font: 11, maxName: 22 };

const ease = (k: number) => 1 - Math.pow(1 - k, 3);
const fmt = (v: number) => v.toFixed(2);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function Chart({ points, pal, layout, t, className }: { points: ChartPoint[]; pal: Palette; layout: Layout; t: number; className: string }) {
  const { w, h, x0, x1, top, bot, font } = layout;
  const px = (v: number) => x0 + (x1 - x0) * Math.min(1, Math.max(0, v));
  const e = ease(t);
  const pops = points.flatMap((p) => (p.popularity === null ? [] : [p.popularity]));
  const lo = pops.length ? Math.min(...pops) : null;
  const hi = pops.length ? Math.max(...pops) : null;

  const geo = points.map((p, i) => {
    const y1 = top + (i % 4) * 7 - 10;
    const y2 = p.inBundle ? bot : bot + ((i % 3) - 1) * 9;
    const xa = p.popularity === null ? px(p.percentile) : px(p.popularity);
    const xb = px(p.percentile);
    return { p, y1, y2, xa, xb, x: xa + (xb - xa) * e, y: y1 + (y2 - y1) * e };
  });
  const colour = (p: ChartPoint) => (p.inBundle ? pal.inBundle : p.tier === 'low' ? pal.low : pal.other);

  // Names of the bundle picks on the taste ruler, staggered over three levels so neighbours do not collide.
  const named = geo.filter((g) => g.p.inBundle).sort((a, b) => a.xb - b.xb);
  const lowDots = geo.filter((g) => !g.p.inBundle && g.p.tier === 'low');
  const lowMid = lowDots.length ? lowDots.reduce((s, g) => s + g.xb, 0) / lowDots.length : null;
  const labelOpacity = t >= 1 ? 1 : 0;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false" className={className} style={{ display: undefined, overflow: 'visible' }}>
      <g style={{ fill: pal.sub, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        <text x={x0} y={20}>Ruler 1 · by popularity</text>
        <text x={x0} y={bot - 104}>Ruler 2 · by taste match</text>
      </g>
      <line x1={x0} x2={x1} y1={top - 44} y2={top - 44} style={{ stroke: pal.axis }} strokeWidth={1} />
      <line x1={x0} x2={x1} y1={bot + 30} y2={bot + 30} style={{ stroke: pal.axis }} strokeWidth={1} />
      <g style={{ fill: pal.sub, fontSize: font }}>
        <text x={x0} y={top - 28}>0</text>
        <text x={x1} y={top - 28} textAnchor="end">1.0</text>
        <text x={x0} y={bot + 52}>Low</text>
        <text x={x1} y={bot + 52} textAnchor="end">High</text>
      </g>
      {lo !== null && hi !== null && (
        <g>
          <rect x={px(lo) - 7} y={top - 24} width={px(hi) - px(lo) + 14} height={52} style={{ fill: 'none', stroke: pal.low }} strokeWidth={1} />
          <text x={px(lo) - 14} y={top - 2} textAnchor="end" style={{ fill: pal.low, fontSize: font }}>
            {`All ${pops.length} sit between ${fmt(lo)} and ${fmt(hi)}`}
          </text>
        </g>
      )}
      {geo.map(({ p, xa, y1, x, y }) =>
        p.popularity === null ? null : (
          <line key={`l-${p.id}`} x1={xa} y1={y1} x2={x} y2={y} style={{ stroke: p.inBundle ? pal.inBundle : p.tier === 'low' ? pal.low : pal.otherLine }}
            strokeWidth={p.inBundle ? 1.4 : 0.7} opacity={p.inBundle || p.tier === 'low' ? 0.85 : 0.7} />
        ),
      )}
      {[...geo].sort((a, b) => Number(a.p.inBundle) - Number(b.p.inBundle)).map(({ p, x, y }) => (
        <circle key={`d-${p.id}`} cx={x} cy={y} r={p.inBundle ? 6 : 4.5} style={{ fill: colour(p), stroke: pal.halo }} strokeWidth={1.5}
          opacity={p.popularity === null ? e : 1} />
      ))}
      <g style={{ opacity: labelOpacity, transition: 'opacity 300ms ease-out', fill: pal.text, fontSize: font, fontWeight: 500 }}>
        {named.map((g, i) => {
          const ly = bot - 26 - (i % 3) * 16;
          const anchor = 'end';
          return (
            <g key={`n-${g.p.id}`}>
              <line x1={g.xb} x2={g.xb} y1={bot - 6} y2={ly + 4} style={{ stroke: pal.inBundle }} strokeWidth={0.7} opacity={0.7} />
              <text x={g.xb + 6} y={ly} textAnchor={anchor}>{clip(g.p.name, layout.maxName)}</text>
            </g>
          );
        })}
        {lowMid !== null && (
          <text x={Math.min(Math.max(lowMid, x0 + 50), x1 - 50)} y={bot - 22} textAnchor="middle" style={{ fill: pal.low, fontWeight: 400 }}>
            Skipped, low fit
          </text>
        )}
      </g>
    </svg>
  );
}

export function TwoRulers({ points, variant = 'paper', animate = true, caption }: {
  points: ChartPoint[]; variant?: 'paper' | 'ink'; animate?: boolean; caption?: string;
}) {
  const [progress, setProgress] = useState(0);
  const t = animate ? progress : 1;
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!animate) return;
    const duration = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : DURATION_MS;
    let raf = 0;
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      const t0 = performance.now();
      const step = (now: number) => {
        const k = duration === 0 ? 1 : Math.min(1, (now - t0) / duration);
        setProgress(k);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { run(); return () => cancelAnimationFrame(raf); }
    const io = new IntersectionObserver((entries) => { if (entries.some((x) => x.isIntersecting)) { io.disconnect(); run(); } }, { threshold: 0.3 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [animate]);

  if (points.length === 0) return null;
  const pal = variant === 'ink' ? INK : PAPER;
  const pops = points.flatMap((p) => (p.popularity === null ? [] : [p.popularity]));
  const popClause = pops.length ? `Popularity is ${fmt(Math.min(...pops))} to ${fmt(Math.max(...pops))} for all ${pops.length}` : 'Popularity is not available';
  const label = `${popClause}; taste match spreads from low to high`;
  const legendDot = (c: string) => <i aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ background: c }} />;

  return (
    <figure ref={ref} className="m-0" style={{ color: pal.text }}>
      {caption && <figcaption className="label mb-3" style={{ color: pal.sub }}>{caption}</figcaption>}
      <div role="img" aria-label={label}>
        <Chart points={points} pal={pal} layout={WIDE} t={t} className="hidden h-auto w-full max-w-[960px] sm:block" />
        <Chart points={points} pal={pal} layout={COMPACT} t={t} className="block h-auto w-full sm:hidden" />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]" style={{ color: pal.sub }}>
        <span className="inline-flex items-center gap-2">{legendDot(pal.inBundle)}In the best bundle</span>
        <span className="inline-flex items-center gap-2">{legendDot(pal.low)}Skipped, low fit</span>
        <span className="inline-flex items-center gap-2">{legendDot(pal.other)}Other candidates</span>
      </div>
    </figure>
  );
}
