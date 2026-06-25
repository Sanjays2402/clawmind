'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { pageTitle } from '@/lib/pageTitle';

/**
 * Keeps `document.title` in sync with the current route on the client.
 *
 * The root layout sets a static `title: 'ClawMind'` so the server-rendered
 * markup and every client-navigated page would otherwise share one title.
 * This component reads the pathname and writes a per-route title like
 * "Pins · ClawMind", improving tab labels, history entries and bookmarks.
 *
 * Routes that own their title via a server `generateMetadata` (trust,
 * incidents, sbom, the public share page, etc.) resolve to `null` here, so we
 * leave their server-set title untouched. Mounted once at the root; renders
 * nothing.
 */
export function DocumentTitle() {
  const pathname = usePathname();
  useEffect(() => {
    const title = pageTitle(pathname);
    if (title && typeof document !== 'undefined' && document.title !== title) {
      document.title = title;
    }
  }, [pathname]);
  return null;
}
