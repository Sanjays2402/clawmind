'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { recordRecent } from '@/lib/recentPages';

/**
 * Records the current route into the recent-pages store on every navigation.
 *
 * Mounted once at the root (next to DocumentTitle). The command palette reads
 * the store to float recently-visited pages to the top under a "Recent"
 * section. Renders nothing. The store de-dupes and caps itself, so this just
 * fires recordRecent on each pathname change.
 */
export function RecentPagesRecorder() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) recordRecent(pathname);
  }, [pathname]);
  return null;
}
