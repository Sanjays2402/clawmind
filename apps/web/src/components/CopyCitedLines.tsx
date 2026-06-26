'use client';
import { useState } from 'react';
import { IconCopy, IconCheck, useToast } from '@clawmind/ui';

/**
 * Copy the exact cited line text (NOT the whole file) to the clipboard, with
 * a toast confirm. Rendered next to the "cited N-M" pill in the source-viewer
 * header. The cited text is computed server-side from the fetched window and
 * the cited band, so this component just owns the clipboard write + feedback.
 *
 * Falls back to a quiet error toast when the clipboard API is unavailable
 * (non-secure context / blocked), mirroring CopyAnswerButton.
 */
export function CopyCitedLines({
  text,
  start,
  end,
}: {
  text: string;
  start: number;
  end: number;
}) {
  const { toast } = useToast();
  const [justCopied, setJustCopied] = useState(false);

  const lineCount = end - start + 1;
  const rangeLabel = end > start ? `${start}-${end}` : String(start);

  async function copy() {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        throw new Error('Clipboard not available');
      }
      await navigator.clipboard.writeText(text);
      setJustCopied(true);
      toast({
        tone: 'success',
        title: `Cited line${lineCount === 1 ? '' : 's'} copied`,
        description: `Line${lineCount === 1 ? '' : 's'} ${rangeLabel} (${text.length.toLocaleString()} characters)`,
      });
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
      aria-label={`Copy cited line${lineCount === 1 ? '' : 's'} ${rangeLabel} to clipboard`}
      title="Copy the cited lines (not the whole file)"
      className="cm-mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        marginLeft: 6,
        padding: '1px 7px',
        borderRadius: 999,
        fontSize: 11,
        cursor: 'pointer',
        color: justCopied ? 'var(--cm-success)' : 'var(--cm-cite)',
        background: 'var(--cm-cite-bg)',
        border: '1px solid var(--cm-cite-line)',
        transition: 'color 120ms ease',
      }}
    >
      {justCopied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      {justCopied ? 'Copied' : 'Copy'}
    </button>
  );
}
