'use client';
import { CitationChip } from '@clawmind/ui';

interface Source { id: string; path: string; startLine: number; endLine: number; excerpt: string; score: number; }

export function ChatStream({ text, sources, onCite }: { text: string; sources: Source[]; onCite: (s: Source) => void }) {
  const parts = renderWithCitations(text, sources, onCite);
  return <article className="cm-chat-stream" style={{ maxWidth: 760 }}>{parts}</article>;
}

function renderWithCitations(text: string, sources: Source[], onCite: (s: Source) => void) {
  const re = /\[\^(\d+)\]/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={`t-${i++}`}>{text.slice(last, m.index)}</span>);
    const n = Number(m[1]);
    const src = sources[n - 1];
    if (src) {
      out.push(<CitationChip key={`c-${i++}`} n={n} path={src.path} onClick={() => onCite(src)} />);
    } else {
      out.push(<span key={`x-${i++}`}>{m[0]}</span>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<span key={`t-${i++}`}>{text.slice(last)}</span>);
  return out;
}
