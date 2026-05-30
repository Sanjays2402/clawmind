'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, IconSpark } from '@clawmind/ui';

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
 */
export function Composer({ value, onChange, onSubmit, loading, onStop }: {
  value: string; onChange: (s: string) => void; onSubmit: () => void; loading: boolean; onStop: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [promptIdx, setPromptIdx] = useState(-1);

  useEffect(() => { ref.current?.focus(); }, []);

  // Auto-grow textarea.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(360, Math.max(96, el.scrollHeight)) + 'px';
  }, [value]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
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
        <span className="cm-mono" style={{ fontSize: 11, color: 'var(--cm-faint)' }}>
          {value.trim() ? `${value.trim().split(/\s+/).length} words` : 'tab cycles a few starters'}
        </span>
        {loading ? (
          <Button variant="ghost" onClick={onStop}>Stop</Button>
        ) : (
          <Button onClick={onSubmit} size="sm">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconSpark size={13} /> Ask
            </span>
          </Button>
        )}
      </div>
    </div>
  );
}
