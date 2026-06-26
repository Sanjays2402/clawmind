'use client';
import { useMemo } from 'react';
import { donutSegments, fmtShare, type DonutDatum } from '@/lib/donut';

// A small, fixed palette for the donut segments. All derived from the warm
// brand inks (accent, citation gold, success, navy soft, muted) plus two
// extra steps so up-to-7 namespaces stay visually distinct before they fold
// into the "Other" remainder. Token-faithful: no invented brand colors.
const SEGMENT_COLORS = [
  'var(--cm-accent)',
  'var(--cm-cite)',
  'var(--cm-success)',
  'var(--cm-fg-soft)',
  'var(--cm-accent-ink)',
  'var(--cm-muted)',
  'var(--cm-border-strong)',
];
const OTHER_COLOR = 'var(--cm-faint)';

const VIEW = 120;
const CX = VIEW / 2;
const CY = VIEW / 2;
const R_OUTER = 54;
const R_INNER = 34;
const MAX_SLICES = 6;

/**
 * Proportion donut for the per-namespace breakdown on /stats, complementing
 * the existing magnitude bars: the bars say "how big", the donut says "what
 * share of the whole". Driven by the SAME metric toggle as the bars so the two
 * always agree. Namespaces past MAX_SLICES fold into a single "Other" slice so
 * the ring never shatters into a confetti of hairline arcs.
 *
 * The SVG ring is aria-hidden; the legend beside it carries the accessible
 * text (name, value, share) so screen-reader users get the full table.
 */
export function NamespaceDonut({
  data,
  metricLabel,
  formatValue,
}: {
  data: DonutDatum[];
  metricLabel: string;
  formatValue: (value: number) => string;
}) {
  // Fold the long tail into "Other" so the ring stays legible, then lay out.
  const { rows, segments } = useMemo(() => {
    const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
    let rows: Array<DonutDatum & { isOther?: boolean }> = sorted;
    if (sorted.length > MAX_SLICES + 1) {
      const head = sorted.slice(0, MAX_SLICES);
      const tail = sorted.slice(MAX_SLICES);
      const otherValue = tail.reduce((s, d) => s + d.value, 0);
      rows = [...head, { key: `Other (${tail.length})`, value: otherValue, isOther: true }];
    }
    const segments = donutSegments(rows, { cx: CX, cy: CY, rOuter: R_OUTER, rInner: R_INNER });
    return { rows, segments };
  }, [data]);

  const total = useMemo(() => rows.reduce((s, d) => s + d.value, 0), [rows]);

  function colorFor(index: number, isOther?: boolean): string {
    if (isOther) return OTHER_COLOR;
    return SEGMENT_COLORS[index % SEGMENT_COLORS.length]!;
  }

  if (segments.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-cm-muted">
        Nothing to chart yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 p-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="relative shrink-0">
        <svg
          width={150}
          height={150}
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          role="img"
          aria-label={`Namespace share of total ${metricLabel.toLowerCase()}`}
        >
          {segments.map((seg, i) => {
            const row = rows[i]!;
            return (
              <path
                key={seg.key}
                d={seg.path}
                fill={colorFor(i, row.isOther)}
                stroke="var(--cm-paper)"
                strokeWidth={1}
              >
                <title>{`${seg.key}: ${formatValue(seg.value)} (${fmtShare(seg.fraction)})`}</title>
              </path>
            );
          })}
        </svg>
        {/* Center readout: the dominant namespace's share. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums leading-none">
            {fmtShare(segments[0]!.fraction)}
          </span>
          <span className="mt-0.5 max-w-[84px] truncate text-[10px] text-cm-muted">
            {segments[0]!.key}
          </span>
        </div>
      </div>

      <ul className="grid w-full min-w-0 flex-1 gap-1.5">
        {segments.map((seg, i) => {
          const row = rows[i]!;
          return (
            <li key={seg.key} className="flex items-center gap-2.5 text-sm">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ background: colorFor(i, row.isOther) }}
              />
              <span className="cm-mono min-w-0 flex-1 truncate text-[13px]" title={seg.key}>
                {seg.key}
              </span>
              <span className="shrink-0 tabular-nums text-cm-muted">
                {formatValue(seg.value)}
              </span>
              <span className="w-10 shrink-0 text-right tabular-nums font-medium">
                {fmtShare(seg.fraction)}
              </span>
            </li>
          );
        })}
        <li className="mt-1 flex items-center justify-between border-t border-cm-border pt-1.5 text-xs text-cm-muted">
          <span>{rows.length} {rows.length === 1 ? 'slice' : 'slices'}</span>
          <span className="tabular-nums">{formatValue(total)} total</span>
        </li>
      </ul>
    </div>
  );
}
