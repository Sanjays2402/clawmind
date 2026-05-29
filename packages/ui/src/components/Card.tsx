import * as React from 'react';

export function Card({ children, style, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={{
        background: 'var(--cm-subtle)',
        border: '1px solid var(--cm-border)',
        borderRadius: 'var(--cm-radius)',
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
