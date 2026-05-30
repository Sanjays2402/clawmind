import * as React from 'react';

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'cite' | 'success' | 'danger' }) {
  const map = {
    neutral: { bg: 'var(--cm-subtle)', fg: 'var(--cm-muted)' },
    accent: { bg: 'var(--cm-accent-soft)', fg: 'var(--cm-accent-ink)' },
    cite: { bg: 'var(--cm-cite-bg)', fg: 'var(--cm-cite)' },
    success: { bg: 'rgba(47,122,85,0.14)', fg: 'var(--cm-success)' },
    danger: { bg: 'rgba(180,66,60,0.14)', fg: 'var(--cm-danger)' },
  } as const;
  const c = map[tone];
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 999,
      background: c.bg,
      color: c.fg,
      fontFamily: 'var(--cm-font-mono)',
      fontSize: 11,
      fontWeight: 500,
      letterSpacing: 0.2,
    }}>
      {children}
    </span>
  );
}
