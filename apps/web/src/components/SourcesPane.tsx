'use client';
import { useMemo, useState } from 'react';
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

// Threshold above which the rail surfaces the filter affordance. Below
// this count the input would be noisier than the rail itself.
const FILTER_SHOW_THRESHOLD = 4;

function matches(s: Source, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if ((s.displayPath ?? s.path).toLowerCase().includes(needle)) return true;
  if (s.excerpt && s.excerpt.toLowerCase().includes(needle)) return true;
  if (s.snippet?.text && s.snippet.text.toLowerCase().includes(needle)) return true;
  return false;
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
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() => {
    if (!filter.trim()) return sources;
    return sources.filter((s) => matches(s, filter.trim()));
  }, [sources, filter]);

  const showFilter = sources.length >= FILTER_SHOW_THRESHOLD;

  if (sources.length === 0) {
    return (
      <div>
        <RailHeader count={0} totalCount={0} />
        <EmptyState title="The margin is empty" hint="Sources will gather here as the answer takes shape." />
      </div>
    );
  }
  return (
    <div>
      <RailHeader count={filtered.length} totalCount={sources.length} />
      {showFilter && (
        <SourcesFilter value={filter} onChange={setFilter} />
      )}
      {filtered.length === 0 && filter.trim() !== '' ? (
        <div
          style={{
            padding: '14px 4px',
            color: 'var(--cm-muted)',
            fontSize: 12.5,
            textAlign: 'center',
          }}
        >
          No sources match <span className="cm-mono">&quot;{filter.trim()}&quot;</span>.
        </div>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          {filtered.map((s) => {
            const isActive = active?.id === s.id;
            const display = s.displayPath ?? s.path;
            // Use the ORIGINAL index in the unfiltered list so citation
            // numbers stay stable across filtering (citation [3] in the
            // answer text always points at the same source no matter
            // what's currently filtered).
            const originalIndex = sources.indexOf(s);
            return (
              <li key={s.id + originalIndex} id={'cm-source-' + s.id}>
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
                      {originalIndex + 1}
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
      )}
    </div>
  );
}

function RailHeader({ count, totalCount }: { count: number; totalCount: number }) {
  const filtered = totalCount > 0 && count !== totalCount;
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
      {totalCount > 0 && (
        <span className="cm-mono" style={{ fontSize: 11, color: 'var(--cm-faint)' }}>
          {filtered
            ? `${count} of ${totalCount}`
            : `${totalCount} source${totalCount === 1 ? '' : 's'}`}
        </span>
      )}
    </div>
  );
}

function SourcesFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        position: 'relative',
        marginBottom: 10,
      }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter sources"
        aria-label="Filter sources by path or snippet text"
        spellCheck={false}
        style={{
          width: '100%',
          background: 'var(--cm-paper)',
          border: '1px solid var(--cm-border)',
          borderRadius: 6,
          padding: '6px 28px 6px 10px',
          fontFamily: 'var(--cm-font-mono)',
          fontSize: 12,
          color: 'var(--cm-fg)',
          outline: 'none',
          transition: 'border-color 120ms ease',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--cm-accent-line)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--cm-border)';
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear filter"
          style={{
            position: 'absolute',
            right: 6,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'transparent',
            border: 'none',
            color: 'var(--cm-faint)',
            cursor: 'pointer',
            padding: 2,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6 L18 18 M18 6 L6 18" />
          </svg>
        </button>
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
