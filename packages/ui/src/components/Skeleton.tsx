'use client';
import * as React from 'react';

// Lightweight skeleton primitives for the chat reading column + source rail.
// The current loading state is a single spinner with a "reading the workspace"
// label. The skeleton replaces it with a layout-faithful placeholder that:
//   1. shows the shape of the page that's about to load (paragraph lines on
//      the left, source cards on the right) so the visual hierarchy doesn't
//      rearrange when the answer streams in;
//   2. uses a calm CSS pulse (1.6s) — no fast bouncing — that respects
//      prefers-reduced-motion users by collapsing to a static skeleton.
//
// All bars use cm-subtle/cm-border so they fit the paper-cream palette
// without introducing a new color token. Keeps the design language tight.

const ANIM_KEYFRAMES = `@keyframes cm-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 0.85; } }`;

/**
 * A single horizontal skeleton bar. width is a percentage of the parent.
 */
export function SkeletonBar({
  width = '100%',
  height = 12,
  radius = 6,
  delayMs = 0,
}: {
  width?: number | string;
  height?: number;
  radius?: number;
  /** Negative delay so each bar pulses at a slightly offset phase. */
  delayMs?: number;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width: typeof width === 'number' ? `${width}px` : width,
        height,
        borderRadius: radius,
        background: 'var(--cm-subtle)',
        animation: 'cm-pulse 1.6s ease-in-out infinite',
        animationDelay: `${delayMs}ms`,
      }}
    />
  );
}

/**
 * The chat answer column skeleton. Renders the keyframes once and then
 * a stack of horizontal bars mimicking three paragraphs. The widths step
 * down on the last line of each paragraph so the silhouette reads as
 * prose rather than as a rectangle.
 */
export function ChatAnswerSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading answer" role="status">
      <style>{ANIM_KEYFRAMES}</style>
      <div style={{ display: 'grid', gap: 10 }}>
        {/* Paragraph 1 */}
        <SkeletonBar width="94%" delayMs={0} />
        <SkeletonBar width="98%" delayMs={120} />
        <SkeletonBar width="72%" delayMs={240} />
      </div>
      <div style={{ height: 14 }} />
      <div style={{ display: 'grid', gap: 10 }}>
        {/* Paragraph 2 */}
        <SkeletonBar width="96%" delayMs={60} />
        <SkeletonBar width="89%" delayMs={180} />
        <SkeletonBar width="92%" delayMs={300} />
        <SkeletonBar width="58%" delayMs={420} />
      </div>
      <div style={{ height: 14 }} />
      <div style={{ display: 'grid', gap: 10 }}>
        {/* Paragraph 3 */}
        <SkeletonBar width="83%" delayMs={140} />
        <SkeletonBar width="44%" delayMs={260} />
      </div>
      <span style={visuallyHidden}>Reading the workspace…</span>
    </div>
  );
}

/**
 * The source rail skeleton. Three placeholder cards matching the real
 * SourcesPane cards: pill + path line + 2 snippet lines.
 */
export function SourcesRailSkeleton() {
  return (
    <div aria-hidden="true">
      <style>{ANIM_KEYFRAMES}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <SkeletonBar width={60} height={10} delayMs={0} />
        <SkeletonBar width={36} height={10} delayMs={80} />
      </div>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            style={{
              padding: '12px 13px',
              border: '1px solid var(--cm-border)',
              borderRadius: 8,
              background: 'var(--cm-paper)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 22,
                  height: 16,
                  borderRadius: 999,
                  background: 'var(--cm-cite-bg)',
                  border: '1px solid var(--cm-cite-line)',
                  flexShrink: 0,
                }}
              />
              <SkeletonBar width="60%" height={11} delayMs={i * 90} />
            </div>
            <SkeletonBar width="100%" delayMs={i * 90 + 80} />
            <SkeletonBar width="78%" delayMs={i * 90 + 160} />
          </li>
        ))}
      </ol>
    </div>
  );
}

const visuallyHidden: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
