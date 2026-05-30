import * as React from 'react';

export function EmptyState({
  title,
  hint,
  body,
  icon,
}: {
  title: string;
  hint?: string;
  body?: string;
  icon?: React.ReactNode;
}) {
  const message = body ?? hint;
  return (
    <div style={{ textAlign: 'center', padding: '36px 24px', color: 'var(--cm-muted)' }}>
      {icon && <div style={{ fontSize: 28, marginBottom: 10, color: 'var(--cm-faint)' }}>{icon}</div>}
      <div
        className="cm-serif"
        style={{
          color: 'var(--cm-fg)',
          fontSize: 17,
          fontWeight: 500,
          marginBottom: 6,
          fontVariationSettings: "'opsz' 18, 'SOFT' 80",
        }}
      >
        {title}
      </div>
      {message && <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{message}</div>}
    </div>
  );
}
