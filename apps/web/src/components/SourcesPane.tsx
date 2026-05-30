'use client';
import { EmptyState } from '@clawmind/ui';

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
    return (
      <div>
        <RailHeader count={0} />
        <EmptyState title="The margin is empty" hint="Sources will gather here as the answer takes shape." />
      </div>
    );
  }
  return (
    <div>
      <RailHeader count={sources.length} />
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
        {sources.map((s, i) => {
          const isActive = active?.id === s.id;
          const display = s.displayPath ?? s.path;
          return (
            <li key={s.id + i} id={'cm-source-' + s.id}>
              <button
                type="button"
                onClick={() => onSelect(s)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 13px',
                  border: '1px solid ' + (isActive ? 'var(--cm-cite-line)' : 'var(--cm-border)'),
                  borderRadius: 8,
                  background: isActive ? 'var(--cm-cite-bg)' : 'var(--cm-paper)',
                  color: 'var(--cm-fg)',
                  cursor: 'pointer',
                  transition: 'border-color 120ms ease, background 120ms ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span
                    className="cm-cite-pill"
                    style={{ position: 'relative', cursor: 'default', flexShrink: 0 }}
                  >
                    {i + 1}
                  </span>
                  <span
                    className="cm-mono"
                    style={{
                      fontSize: 11.5,
                      color: 'var(--cm-cite)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      direction: 'rtl',
                      textAlign: 'left',
                    }}
                    title={display + ':' + s.startLine}
                  >
                    {display}:{s.startLine}
                  </span>
                </div>
                <div style={{ marginTop: 7, fontSize: 13, lineHeight: 1.55, color: 'var(--cm-fg-soft)' }}>
                  {renderSnippet(s)}
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function RailHeader({ count }: { count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
      <h2
        className="cm-mono"
        style={{
          margin: 0,
          fontSize: 11,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color: 'var(--cm-faint)',
        }}
      >
        Margin
      </h2>
      {count > 0 && (
        <span className="cm-mono" style={{ fontSize: 11, color: 'var(--cm-faint)' }}>
          {count} source{count === 1 ? '' : 's'}
        </span>
      )}
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
