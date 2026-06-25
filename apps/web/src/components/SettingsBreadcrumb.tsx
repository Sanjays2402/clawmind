'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconCaretDown } from '@clawmind/ui';
import { settingsSubLabel } from '@/lib/pageTitle';

/**
 * Settings breadcrumb bar. The /settings tree is two levels deep with ~50
 * sub-pages and, until now, no orientation anchor once you're on a leaf: the
 * page heading reads "IP allowlist" with nothing tying it back to Settings.
 *
 * This renders a thin "Settings / <Sub>" trail directly under the TopNav,
 * but ONLY on a settings sub-page (/settings/<sub>). On /settings itself, on
 * non-settings routes, and on deeper-than-two-level paths it renders nothing,
 * so it never adds chrome where there's no hierarchy to show. Mounted once in
 * TopNav so all ~50 settings leaves get it for free.
 */
export function SettingsBreadcrumb() {
  const pathname = usePathname();
  if (!pathname) return null;
  const clean = pathname.split(/[?#]/)[0]!.replace(/\/+$/, '');
  const segments = clean.split('/').filter(Boolean);
  // Only on a settings sub-page: exactly ['settings', '<sub>'].
  if (segments.length !== 2 || segments[0] !== 'settings') return null;
  const sub = segments[1]!;
  const label = settingsSubLabel(sub);

  return (
    <nav
      aria-label="Breadcrumb"
      className="border-b border-cm-border bg-cm-bg/85 backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-[1180px] items-center gap-1.5 px-6 py-2 text-[12px] sm:px-10">
        <Link
          href="/settings"
          className="text-cm-muted transition-colors hover:text-cm-fg"
        >
          Settings
        </Link>
        <IconCaretDown
          size={11}
          aria-hidden="true"
          className="-rotate-90 text-cm-faint"
        />
        <span aria-current="page" className="truncate text-cm-fg">
          {label}
        </span>
      </div>
    </nav>
  );
}
