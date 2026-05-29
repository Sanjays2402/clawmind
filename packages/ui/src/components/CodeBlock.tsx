import * as React from 'react';

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <pre style={{
      background: '#0d0d11',
      color: '#e3e3ea',
      padding: 12,
      borderRadius: 8,
      overflow: 'auto',
      fontFamily: 'var(--cm-font-mono)',
      fontSize: 13,
      border: '1px solid var(--cm-border)',
    }}>
      <code data-lang={lang}>{code}</code>
    </pre>
  );
}
