import * as React from 'react';

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'success' | 'danger' }) {
  const map = {
    neutral: { bg: 'var(--cm-border)', fg: 'var(--cm-muted)' },
    accent: { bg: 'var(--cm-accent-soft)', fg: 'var(--cm-accent)' },
    success: { bg: 'rgba(67,211,158,0.15)', fg: 'var(--cm-success)' },
    danger: { bg: 'rgba(255,93,108,0.15)', fg: 'var(--cm-danger)' },
  } as const;
  const c = map[tone];
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 999,
      background: c.bg,
      color: c.fg,
      fontSize: 12,
      fontWeight: 500,
    }}>
      {children}
    </span>
  );
}
