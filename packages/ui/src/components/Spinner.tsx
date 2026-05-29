import * as React from 'react';

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: 'cm-spin 0.9s linear infinite' }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="36" strokeLinecap="round" />
      <style>{`@keyframes cm-spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}
