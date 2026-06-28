'use client';
import { useEffect, useRef, useState } from 'react';

export interface OutlineTurn {
  id: string;
  question: string;
  sourceCount: number;
}

/**
 * Floating thread navigator. A thread can now hold many Q/A exchanges
 * (see ChatShell's turns model), so a long conversation scrolls well past a
 * single screen. This is the index for it: a bottom-left pill that expands
 * into the list of questions asked, newest first. Clicking one scrolls its
 * exchange into view and makes it the active turn (so the margin rail follows
 * it). The active exchange is marked, and each row shows how many sources
 * grounded that answer.
 *
 * Hidden for a one-exchange thread (nothing to navigate). Mirrors
 * JumpToLatest's bottom-of-viewport placement and reduced-motion scroll, kept
 * as its own component so the two affordances don't share state.
 */
export function ThreadOutline({
  turns,
  activeId,
  onJump,
}: {
  turns: OutlineTurn[];
  activeId: string | null;
  onJump: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on Escape / click-outside while open.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // A single exchange doesn't need an index.
  if (turns.length < 2) return null;

  const activeIdx = turns.findIndex((t) => t.id === activeId);
  const activeLabel = activeIdx >= 0 ? `${activeIdx + 1} / ${turns.length}` : `${turns.length}`;

  return (
    <div
      ref={wrapRef}
      style={{ position: 'fixed', bottom: 22, left: 22, zIndex: 50 }}
    >
      {open && (
        <div
          role="menu"
          aria-label="Jump to an exchange in this thread"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: 0,
            width: 320,
            maxWidth: '78vw',
            maxHeight: '60vh',
            overflowY: 'auto',
            background: 'var(--cm-paper)',
            border: '1px solid var(--cm-border)',
            borderRadius: 12,
            boxShadow: '0 18px 48px rgba(27,35,48,0.18)',
            padding: 6,
          }}
        >
          <div
            className="cm-mono"
            style={{
              padding: '6px 8px 8px',
              fontSize: 10.5,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--cm-faint)',
            }}
          >
            This thread
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
            {turns.map((t, i) => {
              const isActive = t.id === activeId;
              return (
                <li key={t.id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onJump(t.id);
                      setOpen(false);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8,
                      padding: '8px 9px',
                      border: 'none',
                      borderRadius: 8,
                      background: isActive ? 'var(--cm-accent-soft)' : 'transparent',
                      color: 'var(--cm-fg)',
                      cursor: 'pointer',
                      fontFamily: 'var(--cm-font)',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.background = 'var(--cm-subtle)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <span
                      className="cm-mono"
                      style={{
                        flexShrink: 0,
                        fontSize: 10.5,
                        color: isActive ? 'var(--cm-accent)' : 'var(--cm-faint)',
                        minWidth: 16,
                      }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 13,
                          lineHeight: 1.4,
                          color: 'var(--cm-fg)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={t.question}
                      >
                        {t.question}
                      </span>
                      <span
                        className="cm-mono"
                        style={{ display: 'block', marginTop: 2, fontSize: 10.5, color: 'var(--cm-faint)' }}
                      >
                        {t.sourceCount} source{t.sourceCount === 1 ? '' : 's'}
                        {isActive ? ' · in the margin' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Thread outline, ${turns.length} exchanges`}
        title="Jump to an exchange"
        className="cm-mono cm-jump-latest"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          padding: '7px 14px',
          borderRadius: 999,
          fontSize: 12,
          cursor: 'pointer',
          color: 'var(--cm-accent-ink)',
          background: 'var(--cm-paper)',
          border: '1px solid var(--cm-accent-line)',
          boxShadow: '0 8px 24px rgba(27, 35, 48, 0.14)',
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 6h13" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <path d="M3 6h.01" />
          <path d="M3 12h.01" />
          <path d="M3 18h.01" />
        </svg>
        Thread
        <span style={{ color: 'var(--cm-faint)' }}>{activeLabel}</span>
      </button>
    </div>
  );
}
