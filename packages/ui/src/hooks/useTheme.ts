import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

function read(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return (window.localStorage.getItem('cm-theme') as Theme) || 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read());
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('cm-theme', theme);
  }, [theme]);
  return { theme, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') };
}
