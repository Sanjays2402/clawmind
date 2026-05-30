'use client';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Logo, ThemeToggle, IconSpark, IconFolder, IconChartBar, IconDatabase, IconBook, IconSearch } from '@clawmind/ui';

const items: Array<{ href: Route; label: string; Icon: typeof IconSpark }> = [
  { href: '/chat', label: 'Chat', Icon: IconSpark },
  { href: '/search', label: 'Search', Icon: IconSearch },
  { href: '/sources', label: 'Sources', Icon: IconFolder },
  { href: '/stats', label: 'Stats', Icon: IconChartBar },
  { href: '/ingest', label: 'Ingest', Icon: IconDatabase },
  { href: '/saved', label: 'Saved', Icon: IconBook },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-cm-border bg-cm-bg/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <Logo size={22} />
          <span className="text-sm font-semibold tracking-tight">ClawMind</span>
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {items.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname?.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={[
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                  active ? 'bg-cm-accent-soft text-cm-fg' : 'text-cm-muted hover:text-cm-fg',
                ].join(' ')}
              >
                <Icon size={16} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
      {/* Mobile nav */}
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-cm-border px-2 py-1.5 sm:hidden">
        {items.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname?.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={[
                'flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs',
                active ? 'bg-cm-accent-soft text-cm-fg' : 'text-cm-muted',
              ].join(' ')}
            >
              <Icon size={14} />
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
