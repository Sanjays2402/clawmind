'use client';
import * as React from 'react';

// A single modal shell for the app, so CommandPalette / ShortcutHelp /
// ShareAnswerButton stop re-rolling the same backdrop, Esc handler, and
// scroll-lock with drifting radius/shadow/opacity. The design language is the
// house one: paper surface, soft border, deep shadow, calm fade-in honoured
// only when the reader allows motion.
//
// Behaviour: open => locks body scroll, focuses the panel, traps Tab inside,
// closes on Esc + backdrop click. align="start" floats it 10vh from the top
// (palette/help feel), align="center" centres it (confirm dialogs).

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Connects aria-labelledby; pair with an element carrying this id. */
  labelledBy?: string;
  /** Plain accessible name when there is no visible titled element. */
  label?: string;
  align?: 'center' | 'start';
  /** Max panel width in px. */
  maxWidth?: number;
  /**
   * Optional titled header strip. When set, Dialog renders the house header
   * (subtle band, serif title, soft border) so callers stop re-rolling it,
   * and wires aria-labelledby to the title automatically. A close X sits at
   * the trailing edge; pass `titleRight` to add a hint left of it.
   */
  title?: React.ReactNode;
  /** Trailing-edge node in the header, left of the close X (e.g. a hint). */
  titleRight?: React.ReactNode;
  /** Hide the auto close X (rare; for headers that own their dismiss). */
  hideClose?: boolean;
  children: React.ReactNode;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  labelledBy,
  label,
  align = 'center',
  maxWidth = 560,
  title,
  titleRight,
  hideClose = false,
  children,
}: DialogProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [entered, setEntered] = React.useState(false);
  const autoId = React.useId();
  const titleId = title ? autoId : undefined;

  React.useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    // Lock body scroll while open; restore the prior value on close.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus the panel so Tab is captured, then fade in. The next-paint rAF
    // gives the entry transition something to ease from.
    panelRef.current?.focus();
    const raf = requestAnimationFrame(() => setEntered(true));

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Trap Tab within the panel so focus never escapes behind the backdrop.
      const root = panelRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (nodes.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      cancelAnimationFrame(raf);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy ?? titleId}
      aria-label={labelledBy || titleId ? undefined : label}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 55,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: align === 'start' ? 'flex-start' : 'center',
        justifyContent: 'center',
        padding: align === 'start' ? '10vh 16px 16px' : '16px',
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth,
          background: 'var(--cm-paper)',
          border: '1px solid var(--cm-border)',
          borderRadius: 12,
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
          overflow: 'hidden',
          outline: 'none',
          transform: entered ? 'translateY(0)' : 'translateY(6px)',
          opacity: entered ? 1 : 0,
          transition: 'transform 160ms ease, opacity 160ms ease',
        }}
      >
        {title != null && (
          <header
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
              padding: '14px 18px',
              borderBottom: '1px solid var(--cm-border)',
              background: 'var(--cm-subtle)',
            }}
          >
            <h2
              id={titleId}
              className="cm-serif"
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 500,
                color: 'var(--cm-fg)',
                letterSpacing: -0.005,
              }}
            >
              {title}
            </h2>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              {titleRight}
              {!hideClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 22,
                    height: 22,
                    border: 'none',
                    borderRadius: 6,
                    background: 'transparent',
                    color: 'var(--cm-muted)',
                    fontSize: 16,
                    lineHeight: 1,
                    cursor: 'pointer',
                  }}
                >
                  &times;
                </button>
              )}
            </div>
          </header>
        )}
        {children}
      </div>
    </div>
  );
}
