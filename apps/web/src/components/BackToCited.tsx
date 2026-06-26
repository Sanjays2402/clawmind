'use client';
import { useEffect, useState } from 'react';

/**
 * Floating "back to cited lines" affordance for the source viewer. When a
 * source is opened from a citation, the cited band carries id="cm-cited" and
 * is auto-scrolled to centre on arrival. But once the reader expands the
 * context window (ContextStepper) or scrolls through a long file, that band
 * can leave the viewport entirely - and there's no anchor to return to.
 *
 * This watches the band with an IntersectionObserver and, when it's off
 * screen, surfaces a small fixed pill at the bottom of the viewport that
 * scrolls the band back to centre. The pill shows a direction arrow (up when
 * the band is above the viewport, down when below) so the reader knows which
 * way home is. Hidden whenever the band is on screen, and a no-op when there
 * is no cited band (whole-file opens).
 *
 * `target` re-arms the effect on a soft navigation to a different range/pad,
 * mirroring ScrollToCited.
 */
export function BackToCited({ target, label }: { target: string; label: string }) {
  // null = band visible (hide pill); 'up'/'down' = band off-screen in that dir.
  const [dir, setDir] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('cm-cited');
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          setDir(null);
        } else {
          // boundingClientRect.top < 0 => band scrolled above the viewport.
          setDir(entry.boundingClientRect.top < 0 ? 'up' : 'down');
        }
      },
      { root: null, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);

  function jump() {
    const el = document.getElementById('cm-cited');
    if (!el) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }

  if (!dir) return null;

  return (
    <button
      type="button"
      onClick={jump}
      aria-label={`Scroll back to ${label}`}
      title={`Back to ${label}`}
      className="cm-mono cm-back-to-cited"
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
        color: 'var(--cm-cite)',
        background: 'var(--cm-paper)',
        border: '1px solid var(--cm-cite-line)',
        boxShadow: '0 8px 24px rgba(27, 35, 48, 0.14)',
      }}
    >
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
        style={{ transform: dir === 'down' ? 'rotate(180deg)' : undefined }}
      >
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
      </svg>
      {label}
    </button>
  );
}
