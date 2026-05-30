'use client';
import { useEffect } from 'react';
export function useHotkey(combo: string, fn: (e: KeyboardEvent) => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const parts = combo.toLowerCase().split('+');
      const key = parts.pop()!;
      const wantMeta = parts.includes('mod') || parts.includes('cmd');
      const wantShift = parts.includes('shift');
      const metaOk = wantMeta ? e.metaKey || e.ctrlKey : true;
      const shiftOk = wantShift ? e.shiftKey : true;
      if (e.key.toLowerCase() === key && metaOk && shiftOk) {
        fn(e);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [combo, fn]);
}
