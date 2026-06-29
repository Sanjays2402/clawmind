'use client';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { SettingsBreadcrumb } from '@/components/SettingsBreadcrumb';
import { Logo, ThemeToggle, KbdGroup, IconSpark, IconFolder, IconChartBar, IconDatabase, IconBook, IconSearch, IconRefresh, IconPushPin, IconKey, IconChat, IconTag, IconAt, IconSpeakerSlash, IconClockCountdown, IconStethoscope, IconThumbsUp, IconWebhook, IconArchive, IconSettings, IconLink, IconBell, IconWarning, IconShield, IconCaretDown } from '@clawmind/ui';

const primary: Array<{ href: Route; label: string; Icon: typeof IconSpark }> = [
  { href: '/chat', label: 'Ask', Icon: IconSpark },
  { href: '/conversations', label: 'Threads', Icon: IconChat },
  { href: '/search', label: 'Search', Icon: IconSearch },
  { href: '/explain', label: 'Explain', Icon: IconChartBar },
  { href: '/sources', label: 'Sources', Icon: IconFolder },
  { href: '/saved', label: 'Saved', Icon: IconBook },
  { href: '/collections', label: 'Collections', Icon: IconFolder },
];

const secondary: Array<{ href: Route; label: string; Icon: typeof IconSpark }> = [
  { href: '/dashboard', label: 'Dashboard', Icon: IconChartBar },
  { href: '/pins', label: 'Pins', Icon: IconPushPin },
  { href: '/mutes', label: 'Mutes', Icon: IconSpeakerSlash },
  { href: '/feedback', label: 'Feedback', Icon: IconThumbsUp },
  { href: '/tags', label: 'Tags', Icon: IconTag },
  { href: '/aliases', label: 'Aliases', Icon: IconAt },
  { href: '/stale', label: 'Stale', Icon: IconClockCountdown },
  { href: '/doctor', label: 'Doctor', Icon: IconStethoscope },
  { href: '/digests', label: 'Digests', Icon: IconRefresh },
  { href: '/ingest', label: 'Ingest', Icon: IconDatabase },
  { href: '/keys', label: 'Keys', Icon: IconKey },
  { href: '/webhooks', label: 'Webhooks', Icon: IconWebhook },
  { href: '/shares', label: 'Shares', Icon: IconLink },
  { href: '/notifications', label: 'Inbox', Icon: IconBell },
  { href: '/batch', label: 'Batch', Icon: IconArchive },
  { href: '/usage', label: 'Usage', Icon: IconChartBar },
  { href: '/audit', label: 'Audit', Icon: IconWarning },
  { href: '/admin', label: 'Admin', Icon: IconShield },
  { href: '/welcome', label: 'Welcome', Icon: IconSpark },
  { href: '/settings', label: 'Settings', Icon: IconSettings },
];

export function TopNav() {
  const pathname = usePathname();
  const items = [...primary, ...secondary];
  const [unread, setUnread] = useState<number>(0);
  // Roving-tabindex over the primary desktop nav: one link is tabbable at a
  // time, arrow keys move focus between them (ARIA toolbar pattern). Seed the
  // tabbable index at the active route's position so Tab lands on "where you
  // are"; otherwise the first link.
  const navRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const activeNavIdx = primary.findIndex(
    ({ href }) => pathname === href || pathname?.startsWith(href + '/'),
  );
  const [focusIdx, setFocusIdx] = useState(0);
  useEffect(() => {
    setFocusIdx(activeNavIdx >= 0 ? activeNavIdx : 0);
  }, [activeNavIdx]);

  function moveFocus(next: number) {
    const n = primary.length;
    const idx = ((next % n) + n) % n;
    setFocusIdx(idx);
    navRefs.current[idx]?.focus();
  }

  function onNavKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight') { e.preventDefault(); moveFocus(focusIdx + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); moveFocus(focusIdx - 1); }
    else if (e.key === 'Home') { e.preventDefault(); moveFocus(0); }
    else if (e.key === 'End') { e.preventDefault(); moveFocus(primary.length - 1); }
  }
  // One-shot pulse when the unread count crosses from 0 to 1+. We track the
  // previous count and a transient `pulse` flag that auto-clears so the
  // animation fires exactly once per arrival (a quiet "you have new mail"
  // signal), never a constant blink. prevUnreadRef starts at -1 so the very
  // first poll establishing a baseline never triggers a spurious pulse.
  const [pulse, setPulse] = useState(false);
  const prevUnreadRef = useRef<number>(-1);

  // Poll the unread count so the bell badge stays roughly in sync without
  // dragging in a websocket. 30s feels live without hammering the API.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const r = await api.notificationsUnreadCount();
        if (!cancelled) setUnread(r.unread);
      } catch {
        // Anonymous or API down: silently leave the badge at 0.
      } finally {
        if (!cancelled) timer = setTimeout(tick, 30_000);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pathname]);

  // Fire the one-shot pulse only on a genuine 0 -> 1+ rising edge. The first
  // poll (prev === -1) just seeds the baseline.
  useEffect(() => {
    const prev = prevUnreadRef.current;
    prevUnreadRef.current = unread;
    if (prev <= 0 && unread > 0 && prev !== -1) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 1400);
      return () => clearTimeout(t);
    }
  }, [unread]);
  return (
    <>
      <a href="#cm-content" className="cm-skip-link">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-cm-border bg-cm-bg/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4 px-6 py-3 sm:px-10">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={22} />
          <span
            className="cm-serif"
            style={{ fontSize: 18, fontWeight: 500, letterSpacing: -0.01, color: 'var(--cm-fg)' }}
          >
            ClawMind
          </span>
        </Link>
        <nav
          className="hidden items-center gap-0.5 md:flex"
          aria-label="Primary"
          role="toolbar"
          aria-orientation="horizontal"
          onKeyDown={onNavKeyDown}
        >
          {primary.map(({ href, label, Icon }, i) => {
            const active = pathname === href || pathname?.startsWith(href + '/');
            // Roving tabindex: exactly one nav link is in the tab order at a
            // time (the active one, else the first), and arrow keys move focus
            // between siblings. Tab into the bar, then arrow across it.
            const tabbable = i === focusIdx;
            return (
              <Link
                key={href}
                href={href}
                ref={(el) => { navRefs.current[i] = el; }}
                tabIndex={tabbable ? 0 : -1}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
                  active ? 'bg-cm-accent-soft text-cm-fg' : 'text-cm-muted hover:text-cm-fg',
                ].join(' ')}
              >
                <Icon size={14} />
                {label}
              </Link>
            );
          })}
          <MoreMenu pathname={pathname} />
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/notifications"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            className={[
              'relative inline-flex items-center justify-center rounded-md border border-transparent p-1.5 text-cm-muted transition-colors hover:border-cm-border hover:text-cm-fg',
              pulse ? 'cm-bell-pulse' : '',
            ].join(' ')}
          >
            <IconBell size={15} />
            {unread > 0 && (
              <span
                aria-hidden="true"
                className={[
                  'absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-cm-accent px-1 text-center text-[9px] font-medium leading-[14px] text-white',
                  pulse ? 'cm-bell-badge-pop' : '',
                ].join(' ')}
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>
          <span
            aria-hidden="true"
            className="hidden sm:inline-flex"
            title="Open command palette"
          >
            <KbdGroup keys={['⌘', 'K']} boxed size="sm" />
          </span>
          <span
            aria-hidden="true"
            className="hidden sm:inline-flex"
            title="Open keyboard shortcuts (press ?)"
          >
            <KbdGroup keys={['?']} boxed size="sm" />
          </span>
          <ThemeToggle />
        </div>
      </div>
      {/* Mobile nav */}
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-cm-border px-2 py-1.5 md:hidden">
        {items.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname?.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={[
                'flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11.5px]',
                active ? 'bg-cm-accent-soft text-cm-fg' : 'text-cm-muted',
              ].join(' ')}
            >
              <Icon size={13} />
              {label}
            </Link>
          );
        })}
      </nav>
      </header>
      {/* Settings sub-pages get a "Settings / <Sub>" trail directly under the
          nav. Renders nothing on every other route. */}
      <SettingsBreadcrumb />
      {/* Skip-link landing target: focus jumps here, just past the nav.
          tabindex -1 makes it programmatically focusable without entering
          the normal tab order. */}
      <span id="cm-content" tabIndex={-1} className="cm-skip-target" aria-hidden="true" />
    </>
  );
}

/**
 * Desktop "More" overflow dropdown. The primary nav shows 7 surfaces; the
 * other ~20 secondary surfaces were previously reachable on desktop ONLY via
 * the command palette (the horizontal-scroll bar is mobile-only). This closes
 * that discoverability gap with a popover anchored under a "More" trigger.
 *
 * Behaviour: opens on click, closes on Escape, click-outside, or selecting an
 * item (Next navigation unmounts nothing, so we close on click explicitly).
 * The trigger lights up like an active nav item when the current route lives
 * inside the secondary set, so the user always knows "where they are" even
 * when the active page is tucked inside the menu.
 */
function MoreMenu({ pathname }: { pathname: string | null }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const isInSecondary = secondary.some(
    ({ href }) => pathname === href || pathname?.startsWith(href + '/'),
  );

  // Close on click-outside and Escape while open.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More pages"
        className={[
          'flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
          open || isInSecondary ? 'bg-cm-accent-soft text-cm-fg' : 'text-cm-muted hover:text-cm-fg',
        ].join(' ')}
      >
        More
        <IconCaretDown size={12} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="More pages"
          className="absolute right-0 top-[calc(100%+8px)] z-30 w-[440px] rounded-xl border border-cm-border bg-cm-paper p-2 shadow-xl"
        >
          <div className="grid grid-cols-2 gap-0.5">
            {secondary.map(({ href, label, Icon }) => {
              const active = pathname === href || pathname?.startsWith(href + '/');
              return (
                <Link
                  key={href}
                  href={href}
                  role="menuitem"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={[
                    'flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] transition-colors',
                    active ? 'bg-cm-accent-soft text-cm-fg' : 'text-cm-muted hover:bg-cm-subtle hover:text-cm-fg',
                  ].join(' ')}
                >
                  <Icon size={14} />
                  <span className="truncate">{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

