import * as React from 'react';

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div style={{ padding: 16, border: '1px solid var(--cm-danger)', borderRadius: 'var(--cm-radius)', background: 'rgba(255,93,108,0.05)' }}>
      <div style={{ color: 'var(--cm-danger)', fontWeight: 600 }}>{title}</div>
      <div style={{ marginTop: 6, color: 'var(--cm-muted)', fontSize: 14 }}>{message}</div>
      {onRetry && (
        <button onClick={onRetry} style={{ marginTop: 12, background: 'transparent', border: '1px solid var(--cm-border)', borderRadius: 8, padding: '6px 10px', color: 'var(--cm-fg)', cursor: 'pointer' }}>
          Try again
        </button>
      )}
    </div>
  );
}
