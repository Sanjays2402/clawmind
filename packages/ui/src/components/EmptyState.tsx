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
    <div style={{ textAlign: 'center', padding: 48, color: 'var(--cm-muted)' }}>
      {icon && <div style={{ fontSize: 32, marginBottom: 12 }}>{icon}</div>}
      <div style={{ color: 'var(--cm-fg)', fontWeight: 500, marginBottom: 6 }}>{title}</div>
      {message && <div style={{ fontSize: 14 }}>{message}</div>}
    </div>
  );
}
