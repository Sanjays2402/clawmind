'use client';
import { EmptyState, IconFolder } from '@clawmind/ui';

interface SnippetSpan { start: number; end: number }
interface Snippet { text: string; spans: SnippetSpan[] }
interface Source {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  score: number;
  snippet?: Snippet | null;
  displayPath?: string;
}

export function SourcesPane({
  sources,
  active,
  onSelect,
}: {
  sources: Source[];
  active: Source | null;
  onSelect: (s: Source) => void;
}) {
  if (sources.length === 0) {
    return <EmptyState title="No sources yet" hint="Sources appear here once you ask something." />;
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--cm-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Sources</div>
      {sources.map((s, i) => (
        <button
          key={s.id + i}
          onClick={() => onSelect(s)}
          style={{
            textAlign: 'left',
            padding: 12,
            border: '1px solid ' + (active?.id === s.id ? 'var(--cm-accent)' : 'var(--cm-border)'),
            borderRadius: 10,
            background: 'var(--cm-subtle)',
            color: 'var(--cm-fg)',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--cm-muted)', fontFamily: 'var(--cm-font-mono)' }}>
            <IconFolder size={12} />
            <span>[^{i + 1}] {(s.displayPath ?? s.path).split('/').slice(-2).join('/')}:{s.startLine}</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45 }}>
            {renderSnippet(s)}
          </div>
        </button>
      ))}
    </div>
  );
}

function renderSnippet(s: Source) {
  if (s.snippet && s.snippet.text) {
    return <HighlightedText text={s.snippet.text} spans={s.snippet.spans} />;
  }
  const text = s.excerpt ?? '';
  return text.length > 220 ? text.slice(0, 220) + '...' : text;
}

export function HighlightedText({ text, spans }: { text: string; spans: SnippetSpan[] }) {
  if (!spans || spans.length === 0) return <>{text}</>;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((sp, idx) => {
    if (sp.start > cursor) out.push(<span key={`p-${idx}`}>{text.slice(cursor, sp.start)}</span>);
    out.push(<mark key={`m-${idx}`} className="cm-hi">{text.slice(sp.start, sp.end)}</mark>);
    cursor = sp.end;
  });
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{out}</>;
}
