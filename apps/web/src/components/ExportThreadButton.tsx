'use client';
import { useToast } from '@clawmind/ui';
import { threadToMarkdown, threadFileName, type MarkdownTurn } from '@/lib/threadMarkdown';

/**
 * Download the whole running thread as a Markdown file. `turns` is passed
 * oldest-first. The file is built in the browser and handed over through a
 * Blob URL, so nothing leaves the machine.
 */
export function ExportThreadButton({ turns, disabled }: { turns: MarkdownTurn[]; disabled?: boolean }) {
  const { toast } = useToast();

  function exportThread() {
    if (disabled || turns.length === 0) return;
    try {
      const now = new Date();
      const md = threadToMarkdown(turns, now);
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = threadFileName(now);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast({
        tone: 'success',
        title: 'Thread exported',
        description: `${turns.length} ${turns.length === 1 ? 'exchange' : 'exchanges'} saved as Markdown`,
      });
    } catch (err) {
      toast({
        tone: 'error',
        title: 'Could not export thread',
        description: (err as Error).message || 'Download was blocked',
      });
    }
  }

  return (
    <button
      type="button"
      onClick={exportThread}
      disabled={disabled || turns.length === 0}
      title="Download every exchange in this thread, with citations, as a .md file"
      className="cm-mono inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2.5 py-1 text-[11px] text-cm-fg-soft transition-colors hover:bg-cm-accent-soft hover:text-cm-fg disabled:cursor-not-allowed disabled:opacity-50"
    >
      Export .md
    </button>
  );
}
