'use client';
import { useState } from 'react';

export function CopyLink({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* ignore */
        }
      }}
      style={{
        padding: '6px 10px',
        border: '1px solid var(--cm-border)',
        borderRadius: 8,
        background: 'var(--cm-subtle)',
        color: 'var(--cm-fg)',
        fontSize: 12,
        cursor: 'pointer',
      }}
      aria-label="Copy link to this answer"
    >
      {done ? 'Copied' : 'Copy link'}
    </button>
  );
}
