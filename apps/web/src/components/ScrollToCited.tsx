'use client';
import { useEffect } from 'react';

/**
 * When the source viewer is opened via a citation deep-link
 * (?path=&start=&end=), the cited line band carries id="cm-cited". This tiny
 * client component scrolls that band to the centre of the viewport on mount so
 * the reader lands on the exact lines the answer pointed at, with the
 * surrounding context already visible above and below. No-op when there's no
 * cited band on the page.
 *
 * `target` encodes the deep-link (path + line range) so a client-side
 * navigation to a different range re-runs the scroll. The smooth scroll is
 * skipped for prefers-reduced-motion users.
 */
export function ScrollToCited({ target }: { target: string }) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('cm-cited');
    if (!el) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [target]);
  return null;
}
