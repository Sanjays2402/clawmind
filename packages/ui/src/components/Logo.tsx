import * as React from 'react';

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <defs>
        <linearGradient id="cmg" x1="0" y1="0" x2="64" y2="64">
          <stop offset="0" stopColor="#7c5cff" />
          <stop offset="1" stopColor="#43d3e1" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="14" fill="url(#cmg)" opacity="0.18" />
      <path d="M16 40c0-8 6-14 14-14s14 6 14 14" stroke="url(#cmg)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <circle cx="22" cy="24" r="2.5" fill="url(#cmg)" />
      <circle cx="42" cy="24" r="2.5" fill="url(#cmg)" />
    </svg>
  );
}
