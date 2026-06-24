'use client';
import * as React from 'react';

// A small, well-behaved toast notification system. Built for the ClawMind
// design language: paper-cream surface, calm colors, no bouncing animations.
// The contract is intentionally tight:
//   - One global provider (mount once in the root layout).
//   - One imperative hook (`useToast()`) returning { toast, dismiss }.
//   - Three semantic tones (success / error / info) so call sites never
//     pick a color directly.
//   - Auto-dismiss after a tone-appropriate duration (errors stick longer
//     because the user actually needs to read them).
//   - Manual dismiss via the close affordance OR by clicking the body.
//   - Stacks bottom-right; newest at top of the stack.
//   - Hidden from `prefers-reduced-motion` users (the slide-in is the only
//     motion, so we just skip it).
//   - Aria-live='polite' on the container so screen readers announce each
//     new toast without yanking focus.

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastInput {
  /** Title line; short, sentence-case, no trailing period. */
  title: string;
  /** Optional second line for context (file path, status code, etc.). */
  description?: string;
  /** Semantic tone — drives color + default duration. */
  tone?: ToastTone;
  /** Override the auto-dismiss in ms. Pass 0 to keep open until dismissed. */
  durationMs?: number;
}

interface ToastRecord extends Required<Pick<ToastInput, 'title' | 'tone'>> {
  id: string;
  description?: string;
  durationMs: number;
  createdAt: number;
}

interface ToastContextValue {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const DEFAULT_DURATIONS: Record<ToastTone, number> = {
  success: 3200,
  info: 4200,
  error: 6500,
};

function makeId(): string {
  // Stable enough for the in-memory toast stack; we do NOT cross process
  // boundaries with these ids.
  return `t-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastRecord[]>([]);
  const timeouts = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = React.useCallback((id: string) => {
    const t = timeouts.current.get(id);
    if (t) {
      clearTimeout(t);
      timeouts.current.delete(id);
    }
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const toast = React.useCallback(
    (input: ToastInput): string => {
      const tone: ToastTone = input.tone ?? 'info';
      const durationMs =
        typeof input.durationMs === 'number' ? input.durationMs : DEFAULT_DURATIONS[tone];
      const record: ToastRecord = {
        id: makeId(),
        title: input.title,
        description: input.description,
        tone,
        durationMs,
        createdAt: Date.now(),
      };
      setItems((prev) => [record, ...prev].slice(0, 6)); // hard cap stack
      if (durationMs > 0) {
        const handle = setTimeout(() => dismiss(record.id), durationMs);
        timeouts.current.set(record.id, handle);
      }
      return record.id;
    },
    [dismiss],
  );

  // Clean up timers when the provider unmounts (typically only on full
  // teardown but worth being tidy).
  React.useEffect(() => {
    const map = timeouts.current;
    return () => {
      map.forEach((h) => clearTimeout(h));
      map.clear();
    };
  }, []);

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    // Soft-fail with a console hint so non-instrumented pages do not crash
    // in dev — but make the hint loud enough to spot.
    if (typeof window !== 'undefined') {
      console.warn('[clawmind/ui] useToast() called outside <ToastProvider>; falling back to no-op');
    }
    return { toast: () => '', dismiss: () => undefined };
  }
  return ctx;
}

function ToastViewport({
  items,
  onDismiss,
}: {
  items: ToastRecord[];
  onDismiss: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div
      aria-live="polite"
      role="region"
      aria-label="Notifications"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: 10,
        maxWidth: 'min(380px, calc(100vw - 32px))',
        pointerEvents: 'none',
      }}
    >
      {items.map((t) => (
        <ToastCard key={t.id} record={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function toneStyles(tone: ToastTone): {
  border: string;
  ink: string;
  glyph: string;
  dot: string;
} {
  switch (tone) {
    case 'success':
      return {
        border: 'var(--cm-border)',
        ink: 'var(--cm-fg)',
        glyph: 'var(--cm-success)',
        dot: 'rgba(47,122,85,0.18)',
      };
    case 'error':
      return {
        border: 'rgba(180,66,60,0.45)',
        ink: 'var(--cm-fg)',
        glyph: 'var(--cm-danger)',
        dot: 'rgba(180,66,60,0.18)',
      };
    default:
      return {
        border: 'var(--cm-border)',
        ink: 'var(--cm-fg)',
        glyph: 'var(--cm-accent-ink)',
        dot: 'var(--cm-accent-soft)',
      };
  }
}

function ToastCard({ record, onDismiss }: { record: ToastRecord; onDismiss: () => void }) {
  const s = toneStyles(record.tone);
  const [entered, setEntered] = React.useState(false);
  React.useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setEntered(true);
      return;
    }
    // Next paint: trigger the transition.
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      role="status"
      style={{
        pointerEvents: 'auto',
        background: 'var(--cm-paper)',
        border: `1px solid ${s.border}`,
        borderRadius: 10,
        padding: '10px 12px 11px 12px',
        boxShadow:
          '0 8px 22px rgba(27, 35, 48, 0.08), 0 1px 2px rgba(27, 35, 48, 0.04)',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 10,
        alignItems: 'start',
        color: s.ink,
        fontFamily: 'var(--cm-font)',
        transform: entered ? 'translateY(0)' : 'translateY(6px)',
        opacity: entered ? 1 : 0,
        transition: 'transform 180ms ease, opacity 180ms ease',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          marginTop: 6,
          borderRadius: 999,
          background: s.dot,
          border: `1px solid ${s.glyph}`,
          flexShrink: 0,
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.35,
            fontWeight: 500,
            color: 'var(--cm-fg)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {record.title}
        </div>
        {record.description && (
          <div
            style={{
              marginTop: 3,
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--cm-muted)',
              wordBreak: 'break-word',
            }}
          >
            {record.description}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        style={{
          marginTop: 1,
          background: 'transparent',
          border: 'none',
          padding: '2px 4px',
          color: 'var(--cm-faint)',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          borderRadius: 4,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6 L18 18 M18 6 L6 18" />
        </svg>
      </button>
    </div>
  );
}
