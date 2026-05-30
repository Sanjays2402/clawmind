'use client';
import * as React from 'react';

export function CitationChip({ n, path, onClick }: { n: number; path: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      title={path}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 6px',
        height: 18,
        borderRadius: 6,
        background: 'var(--cm-accent-soft)',
        color: 'var(--cm-accent)',
        border: 'none',
        fontFamily: 'var(--cm-font-mono)',
        fontSize: 11,
        cursor: 'pointer',
      }}
    >
      ^{n}
    </button>
  );
}
