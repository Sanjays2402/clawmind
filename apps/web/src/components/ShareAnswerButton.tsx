'use client';
import { useCallback, useState } from 'react';
import { IconLink, IconCopy, IconCheck, IconWarning, Spinner, Dialog, useToast } from '@clawmind/ui';
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
  | { kind: 'ready'; id: string; url: string; copied: boolean; expiresAt: number | null }
  | { kind: 'error'; message: string };

// Bounded set of TTLs we surface in the UI. Server hard-caps at 365d, so
// these all fall well inside the allowed range. "Never" is intentionally
// absent: enterprise admins do not want a one-click immortal link.
const TTL_CHOICES: { label: string; days: number }[] = [
  { label: '1 day', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];
const DEFAULT_TTL_DAYS = 30;

function formatExpiry(ts: number | null): string {
  if (!ts) return 'No expiry';
  try {
    return `Expires ${new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })}`;
  } catch {
    return 'Expires soon';
  }
}

/**
 * Share button that turns a finished answer into a public /s/<id> link.
 *
 * This is the last-mile wiring for the share feature: the API route, the
 * /s/[id] viewer, and the /shares management page already exist. Without
 * this control, users cannot actually create a share from a chat answer.
 */
export function ShareAnswerButton({ query, answer, sources, disabled }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [ttlDays, setTtlDays] = useState<number>(DEFAULT_TTL_DAYS);
  const { toast } = useToast();
  // The dialog opens in an 'idle' state so the user can pick a TTL before
  // the API call. Create transitions the state through creating -> ready.
  const [dialogOpen, setDialogOpen] = useState(false);
  const showDialog = dialogOpen || state.kind === 'creating' || state.kind === 'ready' || state.kind === 'error';

  const cancellable = state.kind !== 'creating';

  const close = useCallback(() => {
    if (!cancellable) return;
    setState({ kind: 'idle' });
    setDialogOpen(false);
  }, [cancellable]);

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
        ttlDays,
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
      setState({ kind: 'ready', id: res.id, url, copied, expiresAt: res.expiresAt });
      toast({
        tone: 'success',
        title: copied ? 'Share link created and copied' : 'Share link created',
        description: copied
          ? formatExpiry(res.expiresAt)
          : 'Copy it from the dialog \u2014 clipboard access was blocked.',
      });
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
      toast({ tone: 'success', title: 'Link copied', description: 'Paste it anywhere to share this answer.' });
      setTimeout(() => {
        setState((cur) =>
          cur.kind === 'ready' && cur.id === state.id ? { ...cur, copied: false } : cur,
        );
      }, 1500);
    } catch {
      toast({ tone: 'error', title: 'Could not copy', description: 'Clipboard access was blocked. Select the field and copy manually.' });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { if (!disabled && answer) { setState({ kind: 'idle' }); setDialogOpen(true); } }}
        disabled={disabled || !answer}
        aria-label="Share this answer as a public link"
        className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2.5 py-1.5 text-xs text-cm-fg-soft hover:bg-cm-accent-soft hover:text-cm-fg disabled:cursor-not-allowed disabled:opacity-50"
      >
        <IconLink size={14} />
        Share
      </button>

      <Dialog
        open={showDialog}
        onClose={close}
        maxWidth={448}
        title="Share this answer"
        hideClose={!cancellable}
      >
        <div className="p-5">
            <p className="text-xs text-cm-muted">
              Anyone with the link can read the question, the answer, and the cited
              sources. You can revoke it any time from the Shares page.
            </p>

            {state.kind === 'idle' || state.kind === 'creating' ? (
              <div className="mt-4">
                <label
                  htmlFor="share-ttl"
                  className="block text-[11px] uppercase tracking-wider text-cm-faint"
                >
                  Link expires after
                </label>
                <select
                  id="share-ttl"
                  value={ttlDays}
                  onChange={(e) => setTtlDays(Number(e.target.value))}
                  disabled={state.kind === 'creating'}
                  className="mt-1 w-full rounded-md border border-cm-border bg-cm-bg-soft px-2.5 py-1.5 text-sm disabled:opacity-60"
                >
                  {TTL_CHOICES.map((c) => (
                    <option key={c.days} value={c.days}>{c.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-cm-faint">
                  After this window the link returns 410 Gone so leaked URLs stop resolving.
                </p>
              </div>
            ) : null}

            {state.kind === 'creating' && (
              <div
                className="mt-5 flex items-center gap-2 text-sm text-cm-muted"
                role="status"
              >
                <Spinner /> Creating share link
              </div>
            )}

            {state.kind === 'idle' && (
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-md border border-cm-border px-2.5 py-1.5 text-xs hover:bg-cm-accent-soft"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={startShare}
                  className="rounded-md border border-cm-border bg-cm-accent px-2.5 py-1.5 text-xs text-white hover:opacity-90"
                >
                  Create link
                </button>
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
                <p className="mt-1 text-[11px] text-cm-muted">{formatExpiry(state.expiresAt)}</p>
                <div className="mt-2 flex items-stretch gap-2">
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
      </Dialog>
    </>
  );
}
