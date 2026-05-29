import * as React from 'react';

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: 48, color: 'var(--cm-muted)' }}>
      {icon && <div style={{ fontSize: 32, marginBottom: 12 }}>{icon}</div>}
      <div style={{ color: 'var(--cm-fg)', fontWeight: 500, marginBottom: 6 }}>{title}</div>
      {hint && <div style={{ fontSize: 14 }}>{hint}</div>}
    </div>
  );
}
