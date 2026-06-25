import * as React from 'react';

// Shared keyboard-chip primitive.
//
// Three surfaces hand-rolled the same `kbd: CSSProperties` block with subtle
// drift: the ShortcutHelp sheet (raised `md` chip), the CommandPalette (flat
// muted `sm` chip), and the TopNav legend (a single boxed pill wrapping a key
// combo). Centralising them here means a future tweak to the chip look lands
// everywhere at once instead of in three places that quietly diverge.
//
// `<Kbd>` is one key. `<KbdGroup keys={['⌘','K']} />` renders a sequence —
// either as separate chips (default) or, with `boxed`, as one bordered pill
// containing plain mono glyphs (the TopNav idiom).

export type KbdSize = 'sm' | 'md';

/** Style for a single standalone chip at the given size. */
function chipStyle(size: KbdSize): React.CSSProperties {
  if (size === 'md') {
    return {
      border: '1px solid var(--cm-border)',
      borderBottom: '1.5px solid var(--cm-border-strong)',
      background: 'var(--cm-bg)',
      borderRadius: 4,
      padding: '2px 6px',
      fontSize: 11,
      fontFamily: 'var(--cm-font-mono)',
      color: 'var(--cm-fg)',
      lineHeight: 1.2,
      minWidth: 18,
      textAlign: 'center',
      display: 'inline-block',
    };
  }
  return {
    border: '1px solid var(--cm-border)',
    borderRadius: 4,
    padding: '1px 5px',
    fontSize: 10.5,
    fontFamily: 'var(--cm-font-mono)',
    color: 'var(--cm-muted)',
    lineHeight: 1.2,
    display: 'inline-block',
  };
}

/** A single keyboard key rendered as a styled <kbd>. */
export function Kbd({
  children,
  size = 'md',
  style,
}: {
  children: React.ReactNode;
  size?: KbdSize;
  style?: React.CSSProperties;
}) {
  return <kbd style={{ ...chipStyle(size), ...style }}>{children}</kbd>;
}

/**
 * A sequence of keys. Default renders each key as its own chip with a small
 * gap. `boxed` renders a single bordered pill (TopNav legend idiom) with the
 * glyphs as plain mono text inside — no per-key border.
 */
export function KbdGroup({
  keys,
  size = 'md',
  boxed = false,
  style,
}: {
  keys: string[];
  size?: KbdSize;
  boxed?: boolean;
  style?: React.CSSProperties;
}) {
  if (boxed) {
    const muted = size === 'sm';
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          border: '1px solid var(--cm-border)',
          borderRadius: 6,
          padding: '4px 8px',
          fontSize: muted ? 10.5 : 11,
          color: muted ? 'var(--cm-muted)' : 'var(--cm-fg)',
          ...style,
        }}
      >
        {keys.map((k, i) => (
          <kbd key={`${k}-${i}`} style={{ fontFamily: 'var(--cm-font-mono)', lineHeight: 1.2 }}>
            {k}
          </kbd>
        ))}
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...style }}>
      {keys.map((k, i) => (
        <Kbd key={`${k}-${i}`} size={size}>
          {k}
        </Kbd>
      ))}
    </span>
  );
}
