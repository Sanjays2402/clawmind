'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

// Pad step + bounds for the "expand context" control. The pad is the number
// of lines shown ABOVE and BELOW the cited band; 0 collapses to just the band,
// the cap keeps a single click from fetching an enormous slice of a big file.
const STEP = 25;
const MIN = 0;
const MAX = 200;

/**
 * Expand/collapse the context shown around the cited band without leaving the
 * page. Each control navigates to the same source-viewer URL with an updated
 * `pad` query param; the server re-renders with a wider/narrower fetch window
 * and the cited band re-centres (its scroll key includes the window bounds).
 *
 * Lives only on citation deep-links (the caller renders it only when a cited
 * band exists). Uses a transition so the buttons dim while the wider window
 * loads, and a Reset that drops the param back to the viewer's default pad.
 */
export function ContextStepper({
  path,
  start,
  end,
  pad,
  defaultPad,
}: {
  path: string;
  start: number;
  end: number;
  pad: number;
  defaultPad: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function navTo(nextPad: number | null) {
    const qs = new URLSearchParams({ path, start: String(start), end: String(end) });
    // null => reset: omit the param so the viewer falls back to its default.
    if (nextPad !== null) qs.set('pad', String(nextPad));
    startTransition(() => {
      router.push(`/sources/view?${qs.toString()}`, { scroll: false });
    });
  }

  function step(delta: number) {
    const next = Math.max(MIN, Math.min(MAX, pad + delta));
    if (next === pad) return;
    navTo(next);
  }

  const atMin = pad <= MIN;
  const atMax = pad >= MAX;
  const isDefault = pad === defaultPad;

  return (
    <span
      role="group"
      aria-label="Lines of context around the cited band"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0,
        marginLeft: 6,
        borderRadius: 999,
        border: '1px solid var(--cm-border)',
        background: 'var(--cm-paper)',
        opacity: isPending ? 0.55 : 1,
        transition: 'opacity 120ms ease',
      }}
    >
      <StepBtn
        label="Show less context"
        glyph="minus"
        disabled={atMin || isPending}
        onClick={() => step(-STEP)}
        edge="left"
      />
      <span
        className="cm-mono"
        title={`${pad} lines of context above and below`}
        style={{
          padding: '0 9px',
          fontSize: 11,
          color: 'var(--cm-muted)',
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}
      >
        &plusmn;{pad}
      </span>
      <StepBtn
        label="Show more context"
        glyph="plus"
        disabled={atMax || isPending}
        onClick={() => step(STEP)}
        edge={isDefault ? 'right' : 'mid'}
      />
      {!isDefault && (
        <button
          type="button"
          onClick={() => navTo(null)}
          disabled={isPending}
          aria-label="Reset context to the default"
          title="Reset to default context"
          className="cm-mono"
          style={{
            padding: '2px 9px',
            fontSize: 11,
            color: 'var(--cm-muted)',
            background: 'transparent',
            border: 'none',
            borderLeft: '1px solid var(--cm-border)',
            borderTopRightRadius: 999,
            borderBottomRightRadius: 999,
            cursor: isPending ? 'default' : 'pointer',
          }}
        >
          Reset
        </button>
      )}
    </span>
  );
}

function StepBtn({
  label,
  glyph,
  disabled,
  onClick,
  edge,
}: {
  label: string;
  glyph: 'plus' | 'minus';
  disabled: boolean;
  onClick: () => void;
  edge: 'left' | 'mid' | 'right';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 22,
        padding: 0,
        background: 'transparent',
        border: 'none',
        color: disabled ? 'var(--cm-faint)' : 'var(--cm-muted)',
        cursor: disabled ? 'default' : 'pointer',
        borderTopLeftRadius: edge === 'left' ? 999 : 0,
        borderBottomLeftRadius: edge === 'left' ? 999 : 0,
        borderTopRightRadius: edge === 'right' ? 999 : 0,
        borderBottomRightRadius: edge === 'right' ? 999 : 0,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M5 12h14" />
        {glyph === 'plus' && <path d="M12 5v14" />}
      </svg>
    </button>
  );
}
