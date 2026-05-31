'use client';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Logo, ThemeToggle, IconSpark, IconFolder, IconChartBar, IconDatabase, IconBook, IconSearch, IconRefresh, IconPushPin, IconKey, IconChat, IconTag, IconAt, IconSpeakerSlash, IconClockCountdown, IconStethoscope, IconThumbsUp } from '@clawmind/ui';

const primary: Array<{ href: Route; label: string; Icon: typeof IconSpark }> = [
  { href: '/chat', label: 'Ask', Icon: IconSpark },
  { href: '/conversations', label: 'Threads', Icon: IconChat },
  { href: '/search', label: 'Search', Icon: IconSearch },
  { href: '/explain', label: 'Explain', Icon: IconChartBar },
  { href: '/sources', label: 'Sources', Icon: IconFolder },
  { href: '/saved', label: 'Saved', Icon: IconBook },
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
];

export function TopNav() {
  const pathname = usePathname();
  const items = [...primary, ...secondary];
  return (
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
          <span
            aria-hidden="true"
            className="hidden items-center gap-1 rounded-md border border-cm-border px-2 py-1 text-[10.5px] text-cm-muted sm:inline-flex"
            title="Open command palette"
          >
            <kbd className="cm-mono">⌘</kbd>
            <kbd className="cm-mono">K</kbd>
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
  );
}
