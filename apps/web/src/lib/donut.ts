// Pure geometry + layout helpers for the namespace-share donut on /stats.
//
// The stats page already ranks namespaces with horizontal bars; the donut adds
// the COMPLEMENTARY view -- each namespace's share of the whole -- so the
// relative weight of the index reads at a glance. All the math lives here,
// dependency-free and unit-testable, so the component is just SVG + tokens.

export interface DonutDatum {
  /** Stable key (the namespace name). */
  key: string;
  /** Non-negative magnitude (files / chunks / bytes for the active metric). */
  value: number;
}

export interface DonutSegment {
  key: string;
  value: number;
  /** Share of the total in [0, 1]. 0 when the total is 0. */
  fraction: number;
  /** Inclusive start / exclusive end angle in degrees, 0 = 12 o'clock, CW. */
  startAngle: number;
  endAngle: number;
  /** SVG path `d` for the ring arc of this segment. */
  path: string;
}

/** Clamp to a finite, non-negative number (NaN / -Inf / negatives -> 0). */
function clampValue(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Convert a polar coordinate (angle in degrees, 0 at 12 o'clock, clockwise)
 * on a circle of radius `r` centred at (cx, cy) into cartesian x/y. Exposed
 * for the legend/label math and tested directly.
 */
export function polarToXy(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  // -90deg shift puts 0deg at the top; positive angles sweep clockwise.
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/**
 * SVG path for a donut-ring arc between two angles (degrees, CW from top),
 * with outer radius `rOuter` and inner radius `rInner`. A full-circle segment
 * (sweep >= 360) is rendered as two half-arcs so the path doesn't degenerate
 * to an invisible zero-length arc.
 */
export function ringArcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;
  if (sweep <= 0) return '';
  if (sweep >= 360) {
    // Two 180deg arcs for a complete ring (avoids the start==end degeneracy).
    const a = ringArcPath(cx, cy, rOuter, rInner, startAngle, startAngle + 180);
    const b = ringArcPath(cx, cy, rOuter, rInner, startAngle + 180, startAngle + 360);
    return `${a} ${b}`;
  }
  const largeArc = sweep > 180 ? 1 : 0;
  const oStart = polarToXy(cx, cy, rOuter, startAngle);
  const oEnd = polarToXy(cx, cy, rOuter, endAngle);
  const iEnd = polarToXy(cx, cy, rInner, endAngle);
  const iStart = polarToXy(cx, cy, rInner, startAngle);
  return [
    `M ${oStart.x.toFixed(3)} ${oStart.y.toFixed(3)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${oEnd.x.toFixed(3)} ${oEnd.y.toFixed(3)}`,
    `L ${iEnd.x.toFixed(3)} ${iEnd.y.toFixed(3)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${iStart.x.toFixed(3)} ${iStart.y.toFixed(3)}`,
    'Z',
  ].join(' ');
}

/**
 * Lay out donut segments from data. Segments are emitted in input order (the
 * caller sorts), each carrying its fraction and the SVG ring-arc path. Zero or
 * negative values are dropped (they can't render an arc). When the total is 0
 * the result is empty. Angles accumulate clockwise from 12 o'clock.
 */
export function donutSegments(
  data: DonutDatum[],
  opts: { cx: number; cy: number; rOuter: number; rInner: number },
): DonutSegment[] {
  const cleaned = data.map((d) => ({ key: d.key, value: clampValue(d.value) }));
  const total = cleaned.reduce((acc, d) => acc + d.value, 0);
  if (total <= 0) return [];
  const out: DonutSegment[] = [];
  let cursor = 0;
  for (const d of cleaned) {
    if (d.value <= 0) continue;
    const fraction = d.value / total;
    const startAngle = cursor * 360;
    const endAngle = (cursor + fraction) * 360;
    out.push({
      key: d.key,
      value: d.value,
      fraction,
      startAngle,
      endAngle,
      path: ringArcPath(opts.cx, opts.cy, opts.rOuter, opts.rInner, startAngle, endAngle),
    });
    cursor += fraction;
  }
  return out;
}

/**
 * Format a fraction in [0,1] as a compact percent string. Values that round to
 * 0% but are non-zero render as "<1%" so a tiny-but-present namespace never
 * looks like it has no share at all.
 */
export function fmtShare(fraction: number): string {
  if (fraction <= 0) return '0%';
  const pct = fraction * 100;
  if (pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}
