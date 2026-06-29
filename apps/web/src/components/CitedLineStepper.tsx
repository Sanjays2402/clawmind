'use client';
import { useEffect, useState } from 'react';

/**
 * "Jump to first / last cited line" stepper for the source viewer. When the
 * cited band spans more rows than fit on screen, scrolling to the top of the
 * band loses the bottom (and vice-versa). This pill scrolls between the band's
 * first (id="cm-cited") and last (id="cm-cited-end") rows so the reader can
 * sweep a tall citation without hunting.
 *
 * It only renders when the band is genuinely taller than the viewport — a
 * short band that's fully visible needs no stepper, so the pill stays hidden
 * to keep the header clean. The check re-runs on resize. `span` is the cited
 * line count; the component no-ops when there's no `cm-cited-end` anchor (a
 * single-line citation, where first === last).
 */
export function CitedLineStepper({ span }: { span: number }) {
  const [tall, setTall] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const measure = () => {
      const top = document.getElementById('cm-cited');
      const end = document.getElementById('cm-cited-end');
      if (!top || !end) {
        setTall(false);
        return;
      }
      const height = end.getBoundingClientRect().bottom - top.getBoundingClientRect().top;
      // Only worth a stepper if the band is taller than ~85% of the viewport.
      setTall(height > window.innerHeight * 0.85);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [span]);

  if (!tall) return null;

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <span
      role="group"
      aria-label="Jump within the cited band"
      className="cm-mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: 6,
        borderRadius: 999,
        border: '1px solid var(--cm-cite-line)',
        background: 'var(--cm-cite-bg)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => jump('cm-cited')}
        aria-label="Jump to first cited line"
        title="First cited line"
        style={endBtn}
      >
        <Chevron up />
      </button>
      <span style={{ fontSize: 11, color: 'var(--cm-cite)', padding: '0 4px', userSelect: 'none' }}>
        {span} cited
      </span>
      <button
        type="button"
        onClick={() => jump('cm-cited-end')}
        aria-label="Jump to last cited line"
        title="Last cited line"
        style={endBtn}
      >
        <Chevron />
      </button>
    </span>
  );
}

const endBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 20,
  padding: 0,
  background: 'transparent',
  border: 'none',
  color: 'var(--cm-cite)',
  cursor: 'pointer',
};

function Chevron({ up }: { up?: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: up ? undefined : 'rotate(180deg)' }}
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}
