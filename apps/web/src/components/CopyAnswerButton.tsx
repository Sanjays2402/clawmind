'use client';
import { useState } from 'react';
import { IconCopy, IconCheck, useToast } from '@clawmind/ui';
import type { Source } from '@/lib/api';

interface Props {
  query: string;
  answer: string;
  sources: Source[];
}

// Format the answer + citations into a single plain-text blob that pastes
// nicely into Slack, email, an issue, or a notes file. The shape is the
// same one ClawMind produces in its own /s/[id] viewer: a `Q:`/`A:`
// header, then a numbered Sources block. Citations in the answer body
// like [1], [2] still resolve to the numbered Sources list, so the paste
// is self-contained.
function formatForClipboard(query: string, answer: string, sources: Source[]): string {
  const head = `Q: ${query.trim()}\n\nA: ${answer.trim()}`;
  if (sources.length === 0) return head + '\n';
  const lines = sources.map((s, i) => {
    const path = s.displayPath ?? s.path;
    const range =
      s.startLine && s.endLine && s.endLine > s.startLine
        ? `${s.startLine}-${s.endLine}`
        : String(s.startLine || 1);
    return `  [${i + 1}] ${path}:${range}`;
  });
  return head + '\n\nSources:\n' + lines.join('\n') + '\n';
}

/**
 * Copy the full Q/A/sources tuple to the clipboard. Shows transient
 * feedback through the global toast system; falls back to a quiet error
 * toast when the clipboard API is blocked (e.g. non-secure context).
 */
export function CopyAnswerButton({ query, answer, sources }: Props) {
  const { toast } = useToast();
  const [justCopied, setJustCopied] = useState(false);

  const disabled = !answer || !query;

  async function copy() {
    if (disabled) return;
    const text = formatForClipboard(query, answer, sources);
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        throw new Error('Clipboard not available');
      }
      await navigator.clipboard.writeText(text);
      setJustCopied(true);
      // Bytes + source count gives the operator a quick "yes the citations
      // came along too" reassurance without forcing them to paste somewhere.
      toast({
        tone: 'success',
        title: 'Answer copied',
        description:
          sources.length === 0
            ? `${text.length.toLocaleString()} characters`
            : `${text.length.toLocaleString()} characters, ${sources.length} source${sources.length === 1 ? '' : 's'} included`,
      });
      // Bounce the icon back to the copy glyph after a beat so the button
      // is ready for the next copy without forcing the toast to time out.
      setTimeout(() => setJustCopied(false), 1500);
    } catch (err) {
      toast({
        tone: 'error',
        title: 'Could not copy',
        description: (err as Error).message || 'Clipboard access was blocked',
      });
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      disabled={disabled}
      aria-label="Copy answer with citations to clipboard"
      className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2.5 py-1.5 text-xs text-cm-fg-soft hover:bg-cm-accent-soft hover:text-cm-fg disabled:cursor-not-allowed disabled:opacity-50"
    >
      {justCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      {justCopied ? 'Copied' : 'Copy'}
    </button>
  );
}
