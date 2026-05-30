'use client';
import { useState, useTransition } from 'react';
import { api } from '@/lib/api';
import { IconThumbsUp, IconThumbsDown, IconCheck, IconWarning } from '@clawmind/ui';

type State =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'ok'; ups: number; downs: number; boost: number }
  | { kind: 'err'; message: string };

export function FeedbackForm({ path, initial }: { path: string; initial?: { ups: number; downs: number; boost: number } | null }) {
  const [state, setState] = useState<State>(
    initial ? { kind: 'ok', ups: initial.ups, downs: initial.downs, boost: initial.boost } : { kind: 'idle' },
  );
  const [pending, start] = useTransition();

  const vote = (v: 1 | -1) => {
    setState({ kind: 'saving' });
    start(async () => {
      try {
        const res = await api.feedbackVote(path, v);
        setState({ kind: 'ok', ups: res.ups, downs: res.downs, boost: res.boost });
      } catch (e) {
        setState({ kind: 'err', message: (e as Error).message });
      }
    });
  };

  return (
    <div style={{ padding: 16, border: '1px solid var(--cm-border)', borderRadius: 10, background: 'var(--cm-subtle)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>How useful is this source?</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={() => vote(1)} disabled={pending} style={btn}>
          <IconThumbsUp /> Helpful
        </button>
        <button onClick={() => vote(-1)} disabled={pending} style={btn}>
          <IconThumbsDown /> Not helpful
        </button>
        {state.kind === 'saving' && <span style={meta}>Saving...</span>}
        {state.kind === 'ok' && (
          <span style={{ ...meta, display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--cm-fg)' }}>
            <IconCheck /> {state.ups} up · {state.downs} down · boost {state.boost.toFixed(2)}
          </span>
        )}
        {state.kind === 'err' && (
          <span style={{ ...meta, display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--cm-warn, #b34c4c)' }}>
            <IconWarning /> {state.message}
          </span>
        )}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 12px', border: '1px solid var(--cm-border)', borderRadius: 8,
  background: 'var(--cm-bg)', color: 'var(--cm-fg)', fontSize: 13, cursor: 'pointer',
};
const meta: React.CSSProperties = { fontSize: 12, color: 'var(--cm-muted)' };
