'use client';
import { CitationChip } from '@clawmind/ui';
import { revealSourceCard } from '@/lib/sourceNav';
import { citePillId } from '@/lib/citations';

interface SnippetSpan { start: number; end: number }
interface Source {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  score: number;
  snippet?: { text: string; spans: SnippetSpan[] } | null;
  displayPath?: string;
}

export function ChatStream({
  text,
  sources,
  activeId,
  onCite,
}: {
  text: string;
  sources: Source[];
  activeId?: string | null;
  onCite: (s: Source) => void;
}) {
  const parts = renderWithCitations(text, sources, activeId ?? null, onCite);
  return <article className="cm-chat-stream" style={{ maxWidth: 720 }}>{parts}</article>;
}

function renderWithCitations(
  text: string,
  sources: Source[],
  activeId: string | null,
  onCite: (s: Source) => void,
) {
  // Match either [^1] or bare [1] forms emitted by the model.
  const re = /\[\^?(\d+)\]/g;
  const out: React.ReactNode[] = [];
  const seenPill = new Set<string>();
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={`t-${i++}`}>{text.slice(last, m.index)}</span>);
    const n = Number(m[1]);
    const src = sources[n - 1];
    if (src) {
      const snippet = src.snippet?.text || src.excerpt;
      const display = src.displayPath ?? src.path;
      const short = display.split('/').slice(-2).join('/') + ':' + src.startLine;
      // Only the FIRST pill for a given source carries the keyboard-nav
      // focus id, so `[` / `]` lands on a stable, single target per source.
      const isFirst = !seenPill.has(src.id);
      seenPill.add(src.id);
      out.push(
        <CitationChip
          key={`c-${i++}`}
          n={n}
          path={short}
          snippet={snippet}
          active={src.id === activeId}
          buttonId={isFirst ? citePillId(src.id) : undefined}
          onClick={() => {
            onCite(src);
            revealSourceCard(src.id);
          }}
        />,
      );
    } else {
      out.push(<span key={`x-${i++}`}>{m[0]}</span>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<span key={`t-${i++}`}>{text.slice(last)}</span>);
  return out;
}
