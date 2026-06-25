'use client';
import { useMemo, useState } from 'react';
import { EmptyState } from '@clawmind/ui';
import { sourceCardId } from '@/lib/sourceNav';

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
            // The viewer reads the file by its REAL path, so the deep-link
            // must use s.path even when displayPath (an alias-shortened
            // label like "@notes/foo.md") is what the card shows.
            const viewerHref =
              '/sources/view?path=' +
              encodeURIComponent(s.path) +
              (s.startLine ? '&start=' + s.startLine : '') +
              (s.endLine ? '&end=' + s.endLine : '');
            return (
              <li
                key={s.id + originalIndex}
                id={sourceCardId(s.id)}
                style={{ position: 'relative' }}
              >
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
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingRight: 24 }}>
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
                <OpenInViewer href={viewerHref} />
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

/**
 * Corner affordance that opens the full file in the source viewer in a
 * new tab, WITHOUT dismissing the active citation. It sits over the card
 * button (which only sets the active source) and stops click/mousedown
 * propagation so opening the viewer never also fires the card's select.
 * Visible on hover/focus-within so the card stays calm at rest.
 */
function OpenInViewer({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Open this source in the viewer (new tab)"
      title="Open in viewer"
      className="cm-open-viewer"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 4h6v6" />
        <path d="M20 4 11 13" />
        <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
      </svg>
    </a>
  );
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
