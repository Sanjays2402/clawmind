'use client';
import { useCallback, useEffect, useState } from 'react';
import { useHotkey, Kbd } from '@clawmind/ui';

interface Shortcut {
  keys: string[]; // e.g. ['⌘', 'K'] — rendered as separate <kbd> chips
  label: string;
  hint?: string;
}

interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

// Single source of truth for the discoverable shortcuts in the app.
// The list is intentionally trimmed to the genuinely useful ones — adding
// every accidental binding would dilute the page. Keep this list curated.
const GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    items: [
      { keys: ['⌘', 'K'], label: 'Open command palette', hint: 'Jump anywhere in the app' },
      { keys: ['?'], label: 'Show this shortcut sheet' },
      { keys: ['Esc'], label: 'Close any dialog' },
    ],
  },
  {
    title: 'Chat',
    items: [
      { keys: ['⌘', 'Enter'], label: 'Send the current question' },
      { keys: ['/'], label: 'Focus the composer', hint: 'From anywhere on the chat page, like the rail j/k' },
      { keys: ['⌘', '/'], label: 'Browse saved prompts', hint: 'Type-to-filter picker anchored to the composer' },
      { keys: ['Tab'], label: 'Cycle through saved starter prompts' },
      { keys: ['Shift', 'Tab'], label: 'Cycle back through saved starters' },
      { keys: ['[', ']'], label: 'Step through the answer citations', hint: 'Focuses each cited source and reveals it in the rail' },
      { keys: ['j', 'k'], label: 'Move down / up the sources rail', hint: 'Arrow keys work too; steps every card, not just cited ones' },
      { keys: ['Enter'], label: 'Open the selected source in the viewer', hint: 'Opens in a new tab when a rail card is active' },
    ],
  },
  {
    title: 'Command palette',
    items: [
      { keys: ['↑', '↓'], label: 'Navigate the result list' },
      { keys: ['Enter'], label: 'Open the selected result' },
      { keys: ['Esc'], label: 'Close the palette' },
    ],
  },
];

/**
 * Discoverable shortcut overlay. Opens on '?' (Shift+/), closes on Esc
 * or click-outside. Mounted once at the root so every page benefits.
 *
 * The overlay is read-only — there is no edit affordance. The keystroke
 * legend on the TopNav already advertises '⌘ K', so '?' is the implicit
 * way to discover everything else.
 */
export function ShortcutHelp() {
  const [open, setOpen] = useState(false);

  // Bind '?' (shift+/) to open the overlay. We deliberately skip mod+/
  // because that's a browser-controlled view-source on some setups.
  useHotkey('?', (e) => {
    // Ignore '?' when the user is typing into an input/textarea/contentEditable —
    // we don't want the help sheet to clobber a legitimate keystroke in
    // the composer or any settings field.
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
    }
    e.preventDefault();
    setOpen((v) => !v);
  });

  // Plumbing: close on Escape (useHotkey treats Esc as a global so we'd
  // collide with the palette; the dialog-level handler scopes neatly).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-help-title"
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 55,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '10vh 16px 16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 560,
          background: 'var(--cm-paper)',
          border: '1px solid var(--cm-border)',
          borderRadius: 12,
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--cm-border)',
            background: 'var(--cm-subtle)',
          }}
        >
          <h2
            id="shortcut-help-title"
            className="cm-serif"
            style={{
              margin: 0,
              fontSize: 17,
              fontWeight: 500,
              color: 'var(--cm-fg)',
              letterSpacing: -0.005,
            }}
          >
            Keyboard shortcuts
          </h2>
          <span
            className="cm-mono"
            style={{ fontSize: 11, color: 'var(--cm-faint)' }}
          >
            press <Kbd>?</Kbd> to toggle
          </span>
        </header>

        <div style={{ padding: '8px 8px 12px' }}>
          {GROUPS.map((group) => (
            <section key={group.title} style={{ padding: '10px 10px 6px' }}>
              <div
                className="cm-mono"
                style={{
                  fontSize: 10.5,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--cm-faint)',
                  padding: '0 4px 6px',
                }}
              >
                {group.title}
              </div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {group.items.map((s) => (
                  <li
                    key={s.label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '7px 8px',
                      borderRadius: 6,
                      transition: 'background-color 100ms ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--cm-subtle)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13.5,
                          color: 'var(--cm-fg)',
                          lineHeight: 1.3,
                        }}
                      >
                        {s.label}
                      </div>
                      {s.hint && (
                        <div
                          style={{
                            marginTop: 2,
                            fontSize: 11.5,
                            color: 'var(--cm-muted)',
                            lineHeight: 1.4,
                          }}
                        >
                          {s.hint}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        flexShrink: 0,
                      }}
                    >
                      {s.keys.map((k, idx) => (
                        <Kbd key={`${s.label}-${idx}`}>
                          {k}
                        </Kbd>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderTop: '1px solid var(--cm-border)',
            fontSize: 11.5,
            color: 'var(--cm-muted)',
          }}
        >
          <span>Shortcuts ignore inputs and textareas, so they never collide with typing.</span>
          <button
            type="button"
            onClick={close}
            style={{
              background: 'transparent',
              border: '1px solid var(--cm-border)',
              borderRadius: 6,
              padding: '4px 10px',
              color: 'var(--cm-fg)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
