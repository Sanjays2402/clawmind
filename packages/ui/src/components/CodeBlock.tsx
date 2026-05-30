import * as React from 'react';

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <pre style={{
      background: 'var(--cm-paper)',
      color: 'var(--cm-fg)',
      padding: 14,
      borderRadius: 8,
      overflow: 'auto',
      fontFamily: 'var(--cm-font-mono)',
      fontSize: 13,
      lineHeight: 1.55,
      border: '1px solid var(--cm-border)',
    }}>
      <code data-lang={lang}>{code}</code>
    </pre>
  );
}
