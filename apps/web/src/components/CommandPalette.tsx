'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { Route } from 'next';
import {
  useHotkey,
  IconSpark,
  IconFolder,
  IconChartBar,
  IconDatabase,
  IconBook,
  IconSearch,
  IconRefresh,
  IconPushPin,
  IconKey,
  IconWarning,
  IconChat,
  IconTag,
  IconAt,
  IconSpeakerSlash,
  IconClockCountdown,
  IconStethoscope,
  IconArrowRight,
  IconThumbsUp,
  IconWebhook,
  IconLink,
  IconBell,
  IconArchive,
  IconShield,
  IconSettings,
  Kbd,
} from '@clawmind/ui';
import { api } from '@/lib/api';
import { readRecent, bestRouteHref } from '@/lib/recentPages';

type RouteItem = {
  id: string;
  kind: 'route';
  label: string;
  href: Route;
  hint?: string;
  Icon: typeof IconSpark;
};

type ActionItem = {
  id: string;
  kind: 'action';
  label: string;
  hint?: string;
  Icon: typeof IconSpark;
  run: (router: ReturnType<typeof useRouter>, query: string) => void;
};

type HistoryItem = {
  id: string;
  kind: 'history';
  label: string;
  hint: string;
  Icon: typeof IconSpark;
  href: Route;
};

// A recently-visited route, surfaced at the top of the empty-query palette so
// the user's frequent jumps are one keystroke closer. Built at open time from
// the recent-pages store, mapped onto a known ROUTE.
type RecentItem = {
  id: string;
  kind: 'recent';
  label: string;
  hint?: string;
  Icon: typeof IconSpark;
  href: Route;
};

type Item = RouteItem | ActionItem | HistoryItem | RecentItem;

const ROUTES: RouteItem[] = [
  // Primary surfaces (mirror the TopNav primary nav).
  { id: 'r-dashboard', kind: 'route', label: 'Dashboard', href: '/dashboard', Icon: IconChartBar, hint: 'Overview' },
  { id: 'r-chat', kind: 'route', label: 'Chat', href: '/chat', Icon: IconSpark, hint: 'Ask a question' },
  { id: 'r-threads', kind: 'route', label: 'Threads', href: '/conversations', Icon: IconChat, hint: 'Conversations' },
  { id: 'r-search', kind: 'route', label: 'Search', href: '/search', Icon: IconSearch, hint: 'Find in index' },
  { id: 'r-explain', kind: 'route', label: 'Explain', href: '/explain', Icon: IconChartBar, hint: 'Retrieval funnel' },
  { id: 'r-sources', kind: 'route', label: 'Sources', href: '/sources', Icon: IconFolder, hint: 'Indexed files' },
  { id: 'r-saved', kind: 'route', label: 'Saved searches', href: '/saved', Icon: IconBook },
  { id: 'r-collections', kind: 'route', label: 'Collections', href: '/collections', Icon: IconFolder, hint: 'Grouped saved searches' },
  // Secondary surfaces — everything tucked under the TopNav "More" menu, so
  // the palette can reach every page the nav exposes (not a curated subset).
  { id: 'r-pins', kind: 'route', label: 'Pins', href: '/pins', Icon: IconPushPin },
  { id: 'r-mutes', kind: 'route', label: 'Mutes', href: '/mutes', Icon: IconSpeakerSlash },
  { id: 'r-feedback', kind: 'route', label: 'Feedback', href: '/feedback', Icon: IconThumbsUp, hint: 'Source up/down votes' },
  { id: 'r-tags', kind: 'route', label: 'Tags', href: '/tags', Icon: IconTag },
  { id: 'r-aliases', kind: 'route', label: 'Aliases', href: '/aliases', Icon: IconAt },
  { id: 'r-stale', kind: 'route', label: 'Stale', href: '/stale', Icon: IconClockCountdown },
  { id: 'r-doctor', kind: 'route', label: 'Doctor', href: '/doctor', Icon: IconStethoscope, hint: 'Index health' },
  { id: 'r-digests', kind: 'route', label: 'Digests', href: '/digests', Icon: IconRefresh },
  { id: 'r-ingest', kind: 'route', label: 'Ingest', href: '/ingest', Icon: IconDatabase },
  { id: 'r-keys', kind: 'route', label: 'API keys', href: '/keys', Icon: IconKey },
  { id: 'r-webhooks', kind: 'route', label: 'Webhooks', href: '/webhooks', Icon: IconWebhook },
  { id: 'r-shares', kind: 'route', label: 'Shares', href: '/shares', Icon: IconLink, hint: 'Public answer links' },
  { id: 'r-inbox', kind: 'route', label: 'Inbox', href: '/notifications', Icon: IconBell, hint: 'Notifications' },
  { id: 'r-batch', kind: 'route', label: 'Batch', href: '/batch', Icon: IconArchive, hint: 'Bulk ask' },
  { id: 'r-stats', kind: 'route', label: 'Stats', href: '/stats', Icon: IconChartBar },
  { id: 'r-usage', kind: 'route', label: 'Usage', href: '/usage', Icon: IconChartBar, hint: 'Request quota' },
  { id: 'r-audit', kind: 'route', label: 'Audit log', href: '/audit', Icon: IconWarning, hint: 'Compliance review' },
  { id: 'r-admin', kind: 'route', label: 'Admin', href: '/admin', Icon: IconShield },
  { id: 'r-welcome', kind: 'route', label: 'Welcome', href: '/welcome', Icon: IconSpark, hint: 'First-run guide' },
  { id: 'r-settings', kind: 'route', label: 'Settings', href: '/settings', Icon: IconSettings },
];

const ACTIONS: ActionItem[] = [
  {
    id: 'a-ask',
    kind: 'action',
    label: 'Ask in chat',
    hint: 'Send the current text to chat',
    Icon: IconSpark,
    run: (router, query) => {
      const q = query.trim();
      if (!q) {
        router.push('/chat');
        return;
      }
      router.push(`/chat?q=${encodeURIComponent(q)}` as Route);
    },
  },
  {
    id: 'a-search',
    kind: 'action',
    label: 'Search the index',
    hint: 'Open the search page with this query',
    Icon: IconSearch,
    run: (router, query) => {
      const q = query.trim();
      router.push(q ? (`/search?q=${encodeURIComponent(q)}` as Route) : '/search');
    },
  },
];

function score(label: string, q: string): number {
  if (!q) return 1;
  const a = label.toLowerCase();
  const b = q.toLowerCase();
  if (a === b) return 1000;
  if (a.startsWith(b)) return 500;
  if (a.includes(b)) return 200;
  // subsequence
  let i = 0;
  for (const ch of a) {
    if (ch === b[i]) i++;
    if (i === b.length) return 50;
  }
  return 0;
}

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useHotkey('mod+k', (e) => {
    e.preventDefault();
    setOpen((v) => !v);
  });

  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Build the "Recent" section when the palette opens: read the stored visited
  // paths, collapse each onto its owning ROUTE (so /settings/security surfaces
  // as "Settings"), drop the page we're currently on, de-dupe, and keep the
  // first few. Reuses each route's own icon + label so the rows are instantly
  // recognizable. Recomputed on open and whenever the route changes.
  useEffect(() => {
    if (!open) return;
    const hrefs = ROUTES.map((r) => r.href as string);
    const here = bestRouteHref(pathname ?? '', hrefs);
    const seen = new Set<string>();
    const built: RecentItem[] = [];
    for (const raw of readRecent()) {
      const href = bestRouteHref(raw, hrefs);
      if (!href || href === here || seen.has(href)) continue;
      const route = ROUTES.find((r) => r.href === href);
      if (!route) continue;
      seen.add(href);
      built.push({
        id: `recent-${href}`,
        kind: 'recent',
        label: route.label,
        hint: 'Recent',
        Icon: route.Icon,
        href: route.href,
      });
      if (built.length >= 5) break;
    }
    setRecent(built);
  }, [open, pathname]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .history()
      .then((items) => {
        if (cancelled) return;
        setHistory(
          items.slice(0, 8).map((h) => ({
            id: `h-${h.id}`,
            kind: 'history',
            label: h.query,
            hint: h.model,
            Icon: IconClockCountdown,
            href: `/chat?q=${encodeURIComponent(h.query)}` as Route,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const items: Item[] = useMemo(() => {
    // Empty query: lead with the "Recent" section, then the full list (routes
    // already shown as recent are dropped from the main list so nothing reads
    // twice on one screen). Recent rows are omitted once the user types — they
    // would just duplicate the routes they point at, which score normally.
    if (!q) {
      const recentHrefs = new Set(recent.map((r) => r.href));
      const rest: Item[] = [
        ...ACTIONS,
        ...ROUTES.filter((r) => !recentHrefs.has(r.href)),
        ...history,
      ];
      return [...recent, ...rest].slice(0, 40);
    }
    const pool: Item[] = [...ACTIONS, ...ROUTES, ...history];
    const ranked = pool
      .map((it) => ({ it, s: score(it.label, q) + (it.kind === 'action' ? 25 : 0) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.it);
    // Cap the visible list. High enough that the whole route list plus recent
    // history fits, not just the first screenful — typing narrows it instantly.
    return ranked.slice(0, 40);
  }, [q, history, recent]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  const run = useCallback(
    (it: Item) => {
      setOpen(false);
      if (it.kind === 'action') {
        it.run(router, q);
      } else {
        router.push(it.href);
      }
    },
    [router, q],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[active];
      if (it) run(it);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '12vh 16px 16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 560,
          background: 'var(--cm-bg)',
          border: '1px solid var(--cm-border)',
          borderRadius: 12,
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--cm-border)' }}>
          <IconSearch size={16} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page, search, or ask"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--cm-fg)',
              fontSize: 15,
            }}
          />
          <Kbd size="sm">esc</Kbd>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 6, maxHeight: '50vh', overflowY: 'auto' }}>
          {items.length === 0 ? (
            <li style={{ padding: 18, color: 'var(--cm-muted)', fontSize: 14, textAlign: 'center' }}>
              No matches. Press enter to ask in chat.
            </li>
          ) : (
            items.map((it, i) => {
              const Icon = it.Icon;
              const isActive = i === active;
              // Section label above the first "Recent" row (empty-query view).
              const showRecentHeader = it.kind === 'recent' && i === 0;
              // Section label above the first non-recent row that follows the
              // recent block, so the two groups read as distinct.
              const prev = items[i - 1];
              const showJumpHeader =
                it.kind !== 'recent' && prev?.kind === 'recent';
              return (
                <li key={it.id}>
                  {showRecentHeader && <SectionLabel>Recent</SectionLabel>}
                  {showJumpHeader && <SectionLabel>Jump to</SectionLabel>}
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => run(it)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '9px 10px',
                      border: 'none',
                      borderRadius: 8,
                      background: isActive ? 'var(--cm-accent-soft)' : 'transparent',
                      color: 'var(--cm-fg)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: 14,
                    }}
                  >
                    <Icon size={16} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.label}
                    </span>
                    {it.hint && (
                      <span style={{ fontSize: 12, color: it.kind === 'recent' ? 'var(--cm-faint)' : 'var(--cm-muted)' }}>{it.hint}</span>
                    )}
                    {isActive && <IconArrowRight size={14} />}
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 12px', borderTop: '1px solid var(--cm-border)', fontSize: 12, color: 'var(--cm-muted)' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <span><Kbd size="sm">↑</Kbd> <Kbd size="sm">↓</Kbd> navigate</span>
            <span><Kbd size="sm">↵</Kbd> select</span>
          </div>
          <span><Kbd size="sm">⌘</Kbd> <Kbd size="sm">K</Kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Small uppercase section heading inside the palette result list (e.g.
 * "Recent" / "Jump to"). Non-interactive; sits between result rows to group
 * them. aria-hidden because the rows it labels are already self-describing.
 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="cm-mono"
      style={{
        padding: '8px 10px 4px',
        fontSize: 10.5,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--cm-faint)',
      }}
    >
      {children}
    </div>
  );
}
