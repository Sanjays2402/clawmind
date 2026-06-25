'use client';

/**
 * Live progress footer shown beneath the answer while it streams. The
 * existing loading state was binary — a skeleton, then the finished
 * answer — so once tokens started arriving there was no signal that work
 * was still happening. This closes that loop with a breathing dot, a
 * running token count, and the gap since the last token landed (a quiet
 * "is it stalling?" tell). It renders nothing until the first token, so
 * it never competes with the skeleton.
 */
export function StreamProgress({
  tokens,
  lastMs,
}: {
  tokens: number;
  lastMs: number | null;
}) {
  if (tokens <= 0) return null;
  return (
    <div
      role="status"
      aria-live="off"
      className="mt-3 flex items-center gap-2 text-[11px] text-cm-faint"
      style={{ fontFamily: 'var(--cm-font-mono)' }}
    >
      <span className="cm-stream-dot" aria-hidden="true" />
      <span>
        {tokens.toLocaleString()} token{tokens === 1 ? '' : 's'}
        {lastMs !== null && lastMs >= 0 ? ` \u00b7 ${formatGap(lastMs)} last token` : ''}
      </span>
    </div>
  );
}

// Compact human gap: sub-second in ms, then seconds with one decimal.
function formatGap(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
