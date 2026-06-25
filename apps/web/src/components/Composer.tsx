'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconSpark, IconSearch } from '@clawmind/ui';

const SAVED_PROMPTS = [
  'what did I commit last Tuesday on snip',
  'summarise my notes from this week',
  'where did I first write about the citation rail',
  'list every TODO still open in memory',
  'what changed in the design tokens recently',
];

/**
 * A calm, generous textarea that lives at the TOP of the page.
 * Tab cycles through saved prompts when the field is empty (or matches a prompt).
 * cmd/ctrl + / opens an explicit, type-to-filter picker for the same prompts.
 */
export function Composer({ value, onChange, onSubmit, loading, onStop, focusSignal }: {
  value: string; onChange: (s: string) => void; onSubmit: () => void; loading: boolean; onStop: () => void;
  /** Increment to imperatively focus the textarea (e.g. "Edit and try again"
   *  from the error state). The caret is moved to the end of the text. */
  focusSignal?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [promptIdx, setPromptIdx] = useState(-1);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => { ref.current?.focus(); }, []);

  // Imperative refocus driven by focusSignal: focus and drop the caret at
  // the end so the user can immediately keep editing the preserved question.
  useEffect(() => {
    if (focusSignal === undefined || focusSignal === 0) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [focusSignal]);

  // Auto-grow textarea.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(360, Math.max(96, el.scrollHeight)) + 'px';
  }, [value]);

  function pickPrompt(prompt: string) {
    onChange(prompt);
    setPickerOpen(false);
    // Drop the caret at the end of the inserted prompt so the user can keep
    // typing immediately.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // cmd/ctrl + / opens the explicit saved-prompt picker. This is the
    // discoverable twin of the Tab-cycling muscle memory below.
    if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setPickerOpen((v) => !v);
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      const trimmed = value.trim();
      const onSaved = trimmed === '' || SAVED_PROMPTS.includes(trimmed);
      if (onSaved) {
        e.preventDefault();
        const next = (promptIdx + 1) % SAVED_PROMPTS.length;
        setPromptIdx(next);
        onChange(SAVED_PROMPTS[next] ?? '');
      }
    }
    if (e.key === 'Tab' && e.shiftKey) {
      const trimmed = value.trim();
      const onSaved = trimmed === '' || SAVED_PROMPTS.includes(trimmed);
      if (onSaved) {
        e.preventDefault();
        const next = (promptIdx - 1 + SAVED_PROMPTS.length) % SAVED_PROMPTS.length;
        setPromptIdx(next);
        onChange(SAVED_PROMPTS[next] ?? '');
      }
    }
  }

  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--cm-paper)',
        border: '1px solid ' + (focused ? 'var(--cm-accent-line)' : 'var(--cm-border)'),
        borderRadius: 12,
        padding: '18px 18px 12px',
        boxShadow: focused ? '0 1px 0 var(--cm-accent-line), 0 6px 24px rgba(27,35,48,0.04)' : '0 1px 0 var(--cm-border)',
        transition: 'border-color 120ms ease, box-shadow 120ms ease',
      }}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Ask anything from your workspace."
        rows={3}
        style={{
          width: '100%',
          resize: 'none',
          padding: 0,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--cm-fg)',
          fontFamily: 'var(--cm-font-display)',
          fontSize: 22,
          lineHeight: 1.4,
          letterSpacing: -0.005,
          fontVariationSettings: "'opsz' 28, 'SOFT' 80",
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 12 }}>
        <button
          type="button"
          onClick={() => { setPickerOpen((v) => !v); ref.current?.focus(); }}
          aria-haspopup="listbox"
          aria-expanded={pickerOpen}
          className="cm-mono"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontSize: 11,
            color: 'var(--cm-faint)',
            cursor: 'pointer',
          }}
          title="Browse saved prompts"
        >
          <IconSearch size={11} />
          {value.trim() ? `${value.trim().split(/\s+/).length} words` : 'saved prompts'}
          <span style={{ opacity: 0.7 }}>&middot; &#8984;/</span>
        </button>
        {loading ? (
          <Button variant="ghost" onClick={onStop}>Stop</Button>
        ) : (
          <Button onClick={() => onSubmit()} size="sm">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconSpark size={13} /> Ask
            </span>
          </Button>
        )}
      </div>

      {pickerOpen && (
        <PromptPicker
          onPick={pickPrompt}
          onClose={() => { setPickerOpen(false); ref.current?.focus(); }}
        />
      )}
    </div>
  );
}

/**
 * Type-to-filter saved-prompt picker anchored beneath the composer. Opens on
 * cmd/ctrl + / (or the "saved prompts" hint button), filters as you type, and
 * navigates with up/down + Enter. The Tab cycling that already exists is fast
 * muscle memory; this is the discoverable, browsable version of the same set.
 */
function PromptPicker({
  onPick,
  onClose,
}: {
  onPick: (prompt: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on click-outside.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [onClose]);

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return SAVED_PROMPTS;
    return SAVED_PROMPTS.filter((p) => p.toLowerCase().includes(q));
  }, [filter]);

  // Keep the active index in range as the filtered set shrinks.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(matches.length - 1, a + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = matches[active];
      if (pick) onPick(pick);
    }
  }

  return (
    <div
      ref={wrapRef}
      role="listbox"
      aria-label="Saved prompts"
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        top: 'calc(100% + 8px)',
        zIndex: 30,
        background: 'var(--cm-paper)',
        border: '1px solid var(--cm-border)',
        borderRadius: 12,
        boxShadow: '0 18px 48px rgba(27,35,48,0.18)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid var(--cm-border)',
        }}
      >
        <IconSearch size={14} />
        <input
          ref={inputRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Filter saved prompts"
          spellCheck={false}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--cm-fg)',
            fontFamily: 'var(--cm-font)',
            fontSize: 14,
          }}
        />
      </div>
      {matches.length === 0 ? (
        <div style={{ padding: '14px 12px', fontSize: 13, color: 'var(--cm-muted)', textAlign: 'center' }}>
          No saved prompt matches.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 6, maxHeight: 260, overflowY: 'auto' }}>
          {matches.map((p, i) => {
            const isActive = i === active;
            return (
              <li key={p} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onPick(p)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '9px 10px',
                    border: 'none',
                    borderRadius: 8,
                    background: isActive ? 'var(--cm-accent-soft)' : 'transparent',
                    color: 'var(--cm-fg)',
                    cursor: 'pointer',
                    fontSize: 14,
                    lineHeight: 1.4,
                    fontFamily: 'var(--cm-font)',
                  }}
                >
                  {p}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
