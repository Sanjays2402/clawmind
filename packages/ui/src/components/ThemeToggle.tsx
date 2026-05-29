import * as React from 'react';
import { IconSun, IconMoon } from '../icons/index.js';
import { useTheme } from '../hooks/useTheme.js';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      style={{ background: 'transparent', border: '1px solid var(--cm-border)', borderRadius: 8, padding: 6, cursor: 'pointer', color: 'var(--cm-fg)' }}
    >
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
    </button>
  );
}
