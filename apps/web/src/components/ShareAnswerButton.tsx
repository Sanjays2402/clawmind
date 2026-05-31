'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconLink, IconCopy, IconCheck, IconWarning, Spinner } from '@clawmind/ui';
import { api, type Source } from '@/lib/api';

interface Props {
  query: string;
  answer: string;
  sources: Source[];
  disabled?: boolean;
}

type State =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'ready'; id: string; url: string; copied: boolean }
  | { kind: 'error'; message: string };

/**
 * Share button that turns a finished answer into a public /s/<id> link.
 *
 * This is the last-mile wiring for the share feature: the API route, the
 * /s/[id] viewer, and the /shares management page already exist. Without
 * this control, users cannot actually create a share from a chat answer.
 */
export function ShareAnswerButton({ query, answer, sources, disabled }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const open = state.kind === 'creating' || state.kind === 'ready' || state.kind === 'error';

  const cancellable = state.kind !== 'creating';

  const close = useCallback(() => {
    if (!cancellable) return;
    setState({ kind: 'idle' });
  }, [cancellable]);

  // Close on Escape, focus the dialog when it opens.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  async function startShare() {
    if (disabled || !answer || !query) return;
    setState({ kind: 'creating' });
    try {
      const res = await api.createShare({
        query,
        answer,
        // Trim source payload to the fields the viewer renders so we never
        // bloat the share JSON with internals.
        sources: sources.slice(0, 32).map((s) => ({
          id: s.id,
          path: s.path,
          startLine: s.startLine,
          endLine: s.endLine,
          excerpt: s.excerpt,
          score: s.score,
        })) as Source[],
      });
      const url =
        typeof window === 'undefined'
          ? res.url
          : `${window.location.origin}${res.url}`;
      let copied = false;
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(url);
          copied = true;
        }
      } catch {
        /* clipboard may be blocked; user can still copy manually */
      }
      setState({ kind: 'ready', id: res.id, url, copied });
    } catch (err) {
      setState({
        kind: 'error',
        message: (err as Error).message || 'Could not create share',
      });
    }
  }

  async function copyAgain() {
    if (state.kind !== 'ready') return;
    try {
      await navigator.clipboard.writeText(state.url);
      setState({ ...state, copied: true });
      setTimeout(() => {
        setState((cur) =>
          cur.kind === 'ready' && cur.id === state.id ? { ...cur, copied: false } : cur,
        );
      }, 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={startShare}
        disabled={disabled || !answer}
        aria-label="Share this answer as a public link"
        className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2.5 py-1.5 text-xs text-cm-fg-soft hover:bg-cm-accent-soft hover:text-cm-fg disabled:cursor-not-allowed disabled:opacity-50"
      >
        <IconLink size={14} />
        Share
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-lg border border-cm-border bg-cm-paper p-5 shadow-xl outline-none"
          >
            <h2
              id="share-dialog-title"
              className="text-base font-semibold tracking-tight"
            >
              Share this answer
            </h2>
            <p className="mt-1 text-xs text-cm-muted">
              Anyone with the link can read the question, the answer, and the cited
              sources. You can revoke it any time from the Shares page.
            </p>

            {state.kind === 'creating' && (
              <div
                className="mt-5 flex items-center gap-2 text-sm text-cm-muted"
                role="status"
              >
                <Spinner /> Creating share link
              </div>
            )}

            {state.kind === 'error' && (
              <div className="mt-5 rounded-md border border-cm-border bg-cm-bg-soft p-3 text-sm text-cm-danger">
                <div className="flex items-center gap-1.5">
                  <IconWarning size={14} /> {state.message}
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md border border-cm-border px-2.5 py-1.5 text-xs hover:bg-cm-accent-soft"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={startShare}
                    className="rounded-md border border-cm-border bg-cm-accent px-2.5 py-1.5 text-xs text-white hover:opacity-90"
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}

            {state.kind === 'ready' && (
              <div className="mt-5">
                <label className="block text-[11px] uppercase tracking-wider text-cm-faint">
                  Public link
                </label>
                <div className="mt-1 flex items-stretch gap-2">
                  <input
                    readOnly
                    value={state.url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 rounded-md border border-cm-border bg-cm-bg-soft px-2.5 py-1.5 font-mono text-xs"
                    aria-label="Public share URL"
                  />
                  <button
                    type="button"
                    onClick={copyAgain}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-cm-border px-2.5 py-1.5 text-xs hover:bg-cm-accent-soft"
                  >
                    {state.copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    {state.copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <a
                    href={state.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-cm-muted hover:text-cm-fg hover:underline"
                  >
                    Open in new tab
                  </a>
                  <div className="flex gap-2">
                    <a
                      href="/shares"
                      className="rounded-md border border-cm-border px-2.5 py-1.5 text-xs hover:bg-cm-accent-soft"
                    >
                      Manage shares
                    </a>
                    <button
                      type="button"
                      onClick={close}
                      className="rounded-md border border-cm-border bg-cm-accent px-2.5 py-1.5 text-xs text-white hover:opacity-90"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
