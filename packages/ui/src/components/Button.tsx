'use client';
import * as React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger' | 'quiet';
  size?: 'sm' | 'md';
  loading?: boolean;
}

export function Button({ variant = 'primary', size = 'md', loading, children, style, ...rest }: ButtonProps) {
  const pad = size === 'sm' ? '6px 10px' : '9px 14px';
  const bg =
    variant === 'primary' ? 'var(--cm-accent)' :
    variant === 'danger' ? 'var(--cm-danger)' :
    variant === 'quiet' ? 'var(--cm-paper)' :
    'transparent';
  const border =
    variant === 'ghost' || variant === 'quiet'
      ? '1px solid var(--cm-border)'
      : '1px solid transparent';
  const color =
    variant === 'ghost' || variant === 'quiet'
      ? 'var(--cm-fg)'
      : '#FBFAF6';
  return (
    <button
      {...rest}
      disabled={loading || rest.disabled}
      style={{
        padding: pad,
        background: bg,
        border,
        borderRadius: 'var(--cm-radius)',
        color,
        fontFamily: 'var(--cm-font)',
        fontWeight: 500,
        fontSize: size === 'sm' ? 13 : 14,
        letterSpacing: -0.005,
        cursor: 'pointer',
        opacity: loading ? 0.7 : 1,
        transition: 'transform 80ms ease, opacity 120ms ease, background 120ms ease',
        ...style,
      }}
    >
      {loading ? 'Working...' : children}
    </button>
  );
}
