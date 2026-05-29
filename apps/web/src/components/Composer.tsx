'use client';
import { useEffect, useRef } from 'react';
import { Button, IconSend } from '@clawmind/ui';

export function Composer({ value, onChange, onSubmit, loading, onStop }: {
  value: string; onChange: (s: string) => void; onSubmit: () => void; loading: boolean; onStop: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div style={{ padding: 16, borderTop: '1px solid var(--cm-border)', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); }
        }}
        placeholder="Ask anything from your workspace. Cmd+Enter to send."
        rows={2}
        style={{
          flex: 1,
          resize: 'none',
          padding: 12,
          borderRadius: 10,
          background: 'var(--cm-subtle)',
          color: 'var(--cm-fg)',
          border: '1px solid var(--cm-border)',
          fontFamily: 'var(--cm-font)',
          fontSize: 14,
        }}
      />
      {loading ? (
        <Button variant="ghost" onClick={onStop}>Stop</Button>
      ) : (
        <Button onClick={onSubmit}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconSend size={14} /> Ask</span>
        </Button>
      )}
    </div>
  );
}
