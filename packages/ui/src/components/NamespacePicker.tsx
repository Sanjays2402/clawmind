import * as React from 'react';

const ALL = ['memory', 'projects', 'sessions', 'docs', 'misc'] as const;
export type Ns = (typeof ALL)[number];

export function NamespacePicker({ value, onChange }: { value: Ns[]; onChange: (v: Ns[]) => void }) {
  const toggle = (n: Ns) => {
    if (value.includes(n)) onChange(value.filter((x) => x !== n));
    else onChange([...value, n]);
  };
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {ALL.map((n) => {
        const active = value.includes(n);
        return (
          <button
            key={n}
            onClick={() => toggle(n)}
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 12,
              border: '1px solid var(--cm-border)',
              background: active ? 'var(--cm-accent-soft)' : 'transparent',
              color: active ? 'var(--cm-accent)' : 'var(--cm-muted)',
              cursor: 'pointer',
            }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
