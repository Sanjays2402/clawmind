'use client';
import { useEffect, useState } from 'react';

/**
 * Floating "jump to latest" affordance for a streaming chat answer. While the
 * answer streams the page grows downward; a reader who scrolls up to re-read an
 * earlier paragraph loses sight of the live token edge with no way back short
 * of manually scrolling to the bottom.
 *
 * This watches a sentinel element (id="cm-stream-end") parked at the very
 * bottom of the answer column with an IntersectionObserver. When that sentinel
 * is off screen AND a stream is active, a small pill appears at the bottom of
 * the viewport that scrolls back down to the live edge. Hidden the moment the
 * sentinel is visible, and a no-op once streaming stops (the live edge is gone,
 * so `active` goes false and the pill is never shown).
 *
 * Mirrors BackToCited's observer + reduced-motion scroll, kept as its own
 * component so the two reading surfaces (viewer / chat) don't share state but
 * do share behaviour.
 */
export function JumpToLatest({ active }: { active: boolean }) {
  // true only when the sentinel has scrolled BELOW the viewport (reader is
  // above the live edge). Above-the-viewport never happens for a bottom
  // sentinel, so a single boolean is enough.
  const [below, setBelow] = useState(false);

  useEffect(() => {
    if (!active) {
      setBelow(false);
      return;
    }
    if (typeof document === 'undefined') return;
    const el = document.getElementById('cm-stream-end');
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        // Off screen below the viewport => the reader is above the live edge.
        setBelow(!entry.isIntersecting && entry.boundingClientRect.top > 0);
      },
      { root: null, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [active]);

  function jump() {
    const el = document.getElementById('cm-stream-end');
    if (!el) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'end', behavior: reduce ? 'auto' : 'smooth' });
  }

  if (!active || !below) return null;

  return (
    <button
      type="button"
      onClick={jump}
      aria-label="Jump to the latest streamed text"
      title="Jump to latest"
      className="cm-mono cm-jump-latest"
      style={{
        position: 'fixed',
        bottom: 22,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '7px 14px',
        borderRadius: 999,
        fontSize: 12,
        cursor: 'pointer',
        color: 'var(--cm-accent-ink)',
        background: 'var(--cm-paper)',
        border: '1px solid var(--cm-accent-line)',
        boxShadow: '0 8px 24px rgba(27, 35, 48, 0.14)',
      }}
    >
      <span className="cm-stream-dot" aria-hidden="true" />
      Jump to latest
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 5v14" />
        <path d="m19 12-7 7-7-7" />
      </svg>
    </button>
  );
}
