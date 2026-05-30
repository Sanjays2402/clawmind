import * as React from 'react';

/**
 * ClawMind mark: a tiny inkwell-and-nib. Warm orange on paper.
 */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="56" height="56" rx="12" fill="var(--cm-accent-soft)" />
      {/* Nib */}
      <path
        d="M20 44 L32 14 L44 44 L36 40 L32 48 L28 40 Z"
        fill="var(--cm-accent)"
        opacity="0.92"
      />
      {/* Slit */}
      <path d="M32 22 L32 40" stroke="var(--cm-paper)" strokeWidth="1.5" strokeLinecap="round" />
      {/* Tip dot */}
      <circle cx="32" cy="48" r="2" fill="var(--cm-fg)" />
    </svg>
  );
}
