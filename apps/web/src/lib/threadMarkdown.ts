// Render a whole chat thread as a self-contained Markdown document.
//
// CopyAnswerButton handles one exchange at a time as plain text. For a long
// research session the reader wants the entire thread as a file they can drop
// into their notes, an issue, or a PR description. Each exchange keeps its own
// numbered citations, so `[1]` inside an answer always resolves to that
// exchange's Sources list (citation numbers are per-turn, not global).

export interface MarkdownSource {
  path: string;
  startLine: number;
  endLine: number;
  displayPath?: string;
}

export interface MarkdownTurn {
  question: string;
  answer: string;
  sources: MarkdownSource[];
  error?: string | null;
}

/** `path:12` or `path:12-40`, matching the copy-to-clipboard format. */
export function sourceRef(s: MarkdownSource): string {
  const path = s.displayPath ?? s.path;
  const range =
    s.startLine && s.endLine && s.endLine > s.startLine
      ? `${s.startLine}-${s.endLine}`
      : String(s.startLine || 1);
  return `${path}:${range}`;
}

/** Normalise `[^2]` footnote-style markers to `[2]` so they don't render as
 *  dangling footnotes in Markdown viewers that support that syntax. */
function normaliseCitations(text: string): string {
  return text.replace(/\[\^(\d+)\]/g, '[$1]');
}

/**
 * Build the Markdown document. `turns` is expected oldest-first (reading
 * order); ChatShell stores newest-first, so it reverses before calling.
 * Turns with no answer (e.g. a failed request) are kept with a note so the
 * export is an honest record of the session.
 */
export function threadToMarkdown(turns: readonly MarkdownTurn[], exportedAt: Date = new Date()): string {
  const out: string[] = [];
  out.push('# ClawMind thread');
  out.push('');
  out.push(
    `_Exported ${exportedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC · ${turns.length} ${turns.length === 1 ? 'exchange' : 'exchanges'}_`,
  );

  turns.forEach((t, i) => {
    out.push('');
    out.push(`## ${i + 1}. ${t.question.trim().replace(/\s+/g, ' ')}`);
    out.push('');
    const answer = normaliseCitations(t.answer.trim());
    if (answer) out.push(answer);
    else out.push(`> _No answer${t.error ? `: ${t.error}` : ''}._`);
    if (answer && t.error) {
      out.push('');
      out.push(`> _Answer stopped early: ${t.error}._`);
    }
    if (t.sources.length > 0) {
      out.push('');
      out.push('**Sources**');
      out.push('');
      t.sources.forEach((s, j) => out.push(`${j + 1}. \`${sourceRef(s)}\``));
    }
  });

  return out.join('\n') + '\n';
}

/** File name for a thread export, e.g. `clawmind-thread-2026-10-05-1432.md`. */
export function threadFileName(exportedAt: Date = new Date()): string {
  const iso = exportedAt.toISOString();
  return `clawmind-thread-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}.md`;
}
