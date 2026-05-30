'use client';
import * as React from 'react';

/**
 * Inline numbered source pill. Appears in the answer body as a superscript
 * with a hover snippet preview. Click jumps to the right-rail source card.
 */
export function CitationChip({
  n,
  path,
  snippet,
  active,
  onClick,
  onHover,
}: {
  n: number;
  path: string;
  snippet?: string;
  active?: boolean;
  onClick?: () => void;
  onHover?: (hovering: boolean) => void;
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => { setHover(true); onHover?.(true); }}
      onMouseLeave={() => { setHover(false); onHover?.(false); }}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={`Source ${n}: ${path}`}
        data-active={active ? 'true' : undefined}
        className="cm-cite-pill"
      >
        {n}
      </button>
      {hover && (snippet || path) && (
        <span role="tooltip" className="cm-cite-pop">
          <span className="cm-pop-path">[{n}] {path}</span>
          {snippet ? trim(snippet, 220) : 'Open in source rail.'}
        </span>
      )}
    </span>
  );
}

function trim(s: string, n: number) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '...' : t;
}
