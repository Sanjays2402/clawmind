'use client';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Logo, ThemeToggle, KbdGroup, IconSpark, IconFolder, IconChartBar, IconDatabase, IconBook, IconSearch, IconRefresh, IconPushPin, IconKey, IconChat, IconTag, IconAt, IconSpeakerSlash, IconClockCountdown, IconStethoscope, IconThumbsUp, IconWebhook, IconArchive, IconSettings, IconLink, IconBell, IconWarning, IconShield } from '@clawmind/ui';

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
        <nav className="hidden items-center gap-0.5 md:flex">
          {primary.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname?.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
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
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/notifications"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            className="relative inline-flex items-center justify-center rounded-md border border-transparent p-1.5 text-cm-muted transition-colors hover:border-cm-border hover:text-cm-fg"
          >
            <IconBell size={15} />
            {unread > 0 && (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-cm-accent px-1 text-center text-[9px] font-medium leading-[14px] text-white"
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
      {/* Skip-link landing target: focus jumps here, just past the nav.
          tabindex -1 makes it programmatically focusable without entering
          the normal tab order. */}
      <span id="cm-content" tabIndex={-1} className="cm-skip-target" aria-hidden="true" />
    </>
  );
}
