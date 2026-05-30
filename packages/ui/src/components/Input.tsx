'use client';
import * as React from 'react';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return (
      <input
        ref={ref}
        {...props}
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 'var(--cm-radius)',
          background: 'var(--cm-subtle)',
          color: 'var(--cm-fg)',
          border: '1px solid var(--cm-border)',
          fontFamily: 'var(--cm-font)',
          outline: 'none',
          ...props.style,
        }}
      />
    );
  },
);
