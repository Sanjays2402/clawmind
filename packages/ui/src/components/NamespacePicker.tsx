'use client';
import * as React from 'react';

const ALL = ['memory', 'projects', 'sessions', 'docs', 'misc'] as const;
export type Ns = (typeof ALL)[number];

/**
 * Breadcrumb-style namespace switcher. Sits in the page header rather than
 * being buried in a sidebar. Each segment is a toggle: lit = included.
 */
export function NamespacePicker({
  value,
  onChange,
  variant = 'pills',
}: {
  value: Ns[];
  onChange: (v: Ns[]) => void;
  variant?: 'pills' | 'breadcrumb';
}) {
  const toggle = (n: Ns) => {
    if (value.includes(n)) onChange(value.filter((x) => x !== n));
    else onChange([...value, n]);
  };

  if (variant === 'breadcrumb') {
    return (
      <nav
        aria-label="Active namespaces"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}
      >
        <span style={{ fontFamily: 'var(--cm-font-mono)', fontSize: 11, color: 'var(--cm-faint)', letterSpacing: 0.5, textTransform: 'uppercase', marginRight: 6 }}>
          workspace
        </span>
        {ALL.map((n, i) => {
          const active = value.includes(n);
          return (
            <React.Fragment key={n}>
              {i > 0 && <span style={{ color: 'var(--cm-faint)', fontSize: 12 }}>/</span>}
              <button
                type="button"
                onClick={() => toggle(n)}
                aria-pressed={active}
                style={{
                  padding: '2px 7px',
                  borderRadius: 4,
                  fontFamily: 'var(--cm-font-mono)',
                  fontSize: 12,
                  background: active ? 'var(--cm-accent-soft)' : 'transparent',
                  color: active ? 'var(--cm-accent-ink)' : 'var(--cm-muted)',
                  border: 'none',
                  cursor: 'pointer',
                  letterSpacing: -0.005,
                }}
              >
                {n}
              </button>
            </React.Fragment>
          );
        })}
      </nav>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {ALL.map((n) => {
        const active = value.includes(n);
        return (
          <button
            key={n}
            type="button"
            onClick={() => toggle(n)}
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontFamily: 'var(--cm-font-mono)',
              border: '1px solid ' + (active ? 'var(--cm-accent-line)' : 'var(--cm-border)'),
              background: active ? 'var(--cm-accent-soft)' : 'transparent',
              color: active ? 'var(--cm-accent-ink)' : 'var(--cm-muted)',
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
