'use client';
import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'cm-theme';

/**
 * The OS-level color-scheme preference, or `light` when it can't be read
 * (SSR / no matchMedia). Light is the app's canonical default — it matches
 * the `data-theme="light"` the root layout renders, so the very first paint
 * is consistent before this hook resolves.
 */
function systemPreference(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The user's explicit, persisted choice — or null if they've never picked. */
function storedChoice(): Theme | null {
  if (typeof window === 'undefined') return null;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'dark' || v === 'light' ? v : null;
}

function apply(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

/**
 * Theme controller with three behaviours, in priority order:
 *   1. An explicit choice (toggle / setTheme) is persisted and always wins.
 *   2. Otherwise the OS `prefers-color-scheme` is detected on first visit...
 *   3. ...and kept live — if the OS flips dark/light mid-session and the user
 *      hasn't pinned a choice, the app follows along.
 *
 * The resolve happens in an effect (not the `useState` initialiser) so the
 * server-rendered markup always matches the light default and there is no
 * hydration mismatch; the real theme lands one paint later.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('light');

  // Resolve the real theme once, on mount: explicit choice, else the OS.
  useEffect(() => {
    const initial = storedChoice() ?? systemPreference();
    setThemeState(initial);
    apply(initial);
  }, []);

  // Live-follow the OS, but only while no explicit choice is pinned. The
  // moment the user toggles, `storedChoice()` returns a value and we stop.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      if (storedChoice()) return;
      const next: Theme = e.matches ? 'dark' : 'light';
      setThemeState(next);
      apply(next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // An explicit choice persists (which also pins us against OS-follow) and
  // applies immediately. System-driven changes deliberately do NOT persist,
  // so OS-follow keeps working until the user opts in to a fixed theme.
  const choose = (next: Theme) => {
    setThemeState(next);
    apply(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  };

  return {
    theme,
    setTheme: choose,
    toggle: () => choose(theme === 'dark' ? 'light' : 'dark'),
  };
}
