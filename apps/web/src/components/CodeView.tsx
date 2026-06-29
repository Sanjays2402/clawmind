'use client';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast, IconSearch } from '@clawmind/ui';
import { highlight, langForPath, type Token, type TokenType } from '@/lib/highlight';
import { isCitedLine, type ContextWindow } from '@/lib/contextWindow';
import { readWrapPref, writeWrapPref, defaultWrapForExt, extOf } from '@/lib/wrapPref';
import { lineSelection, lineLinkHref, linePermalink, lineRangeLabel } from '@/lib/lineLink';

const TOKEN_COLOR: Record<TokenType, string> = {
  kw: 'var(--cm-accent-ink)',
  str: 'var(--cm-success)',
  com: 'var(--cm-faint)',
  num: 'var(--cm-cite)',
  punct: 'var(--cm-muted)',
  plain: 'var(--cm-fg)',
};

// One in-file find hit: the line it lives on (1-based file line) and the
// half-open character span within that line. A stable global ordinal lets
// prev/next cycle across the whole file regardless of which line a hit is on.
interface FindHit {
  line: number; // file line number
  start: number; // char offset in the line
  end: number;
  ord: number; // 0-based global index
}

// Scan every line for case-insensitive occurrences of `q`. Dependency-free,
// reused for both the highlight pass and the prev/next cycle so the count and
// the rendered marks can never disagree. Empty/whitespace query => no hits.
function scanHits(lines: string[], startLine: number, q: string): FindHit[] {
  const needle = q.toLowerCase();
  if (!needle) return [];
  const hits: FindHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const hay = (lines[i] ?? '').toLowerCase();
    let from = 0;
    for (;;) {
      const idx = hay.indexOf(needle, from);
      if (idx === -1) break;
      hits.push({ line: startLine + i, start: idx, end: idx + needle.length, ord: hits.length });
      from = idx + needle.length;
    }
  }
  return hits;
}

/**
 * Read-only code renderer for the source viewer. Highlights by file extension
 * with a restrained ink-on-paper palette (keywords in the accent ink, strings
 * in success green, comments faint, numbers in citation gold). Files with no
 * known grammar render as plain text. The cited band (when present) keeps the
 * .cm-cited-line wash + the id="cm-cited" auto-scroll anchor on its first row.
 *
 * A soft-wrap toggle in the control strip lets the reader switch between
 * horizontal scroll (default for code, faithful to the file's columns) and
 * wrapped long lines (default for prose). The choice is remembered PER FILE
 * TYPE (lib/wrapPref) so flipping a .md file to wrap doesn't also wrap every
 * .ts file. The default before any choice is prose-vs-code by extension.
 *
 * Every gutter line number is a button: clicking it selects that line and
 * copies a shareable permalink (?start=&end=) so a reader can deep-link to
 * ANY line, not just the cited band the viewer opened on. Shift-click extends
 * the current band into a range (lib/lineLink).
 *
 * Cmd/Ctrl+F opens an in-file find overlay scoped to the rendered viewer: the
 * browser's native find skips virtualized/token-split rows, so we walk the raw
 * lines ourselves, highlight every hit, and let Enter / Shift+Enter cycle the
 * active match into view. Dependency-free; while a query is active the line is
 * rendered as plain text so the match marks land cleanly without fighting the
 * token spans.
 */
export function CodeView({
  content,
  path,
  startLine,
  win,
}: {
  content: string;
  path: string;
  startLine: number;
  win: ContextWindow;
}) {
  const spec = useMemo(() => langForPath(path), [path]);
  const lines = useMemo(() => (content.length === 0 ? [] : content.split('\n')), [content]);
  const highlighted = useMemo<Token[][] | null>(
    () => (spec ? highlight(content, spec) : null),
    [content, spec],
  );
  const router = useRouter();
  const { toast } = useToast();

  // Render the per-extension default on both server and first client render so
  // the markup agrees, then apply the persisted per-ext choice after mount (no
  // hydration mismatch). Re-resolve when the file (extension) changes.
  const ext = useMemo(() => extOf(path), [path]);
  const [wrap, setWrap] = useState(() => defaultWrapForExt(ext));
  useEffect(() => {
    setWrap(readWrapPref(path));
  }, [path]);

  // In-file find: query + which match is active. The hit list is derived from
  // the raw lines so it always matches what's drawn. `findOpen` mounts the bar;
  // Esc closes it and clears the query so the viewer returns to plain reading.
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeHit, setActiveHit] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => scanHits(lines, startLine, query), [lines, startLine, query]);
  const hitCount = hits.length;
  // Keep the active ordinal in range as matches shrink while typing.
  useEffect(() => {
    setActiveHit((a) => (hitCount === 0 ? 0 : Math.min(a, hitCount - 1)));
  }, [hitCount]);

  // Optimistic selection: the gutter click navigates, but the server round-trip
  // takes a beat before the new cited band re-renders. Wash the clicked rows
  // immediately so a click ANYWHERE (not just the cited band) gives instant
  // feedback. Cleared when the path/cited band changes (i.e. nav resolved).
  const [pending, setPending] = useState<{ start: number; end: number } | null>(null);
  useEffect(() => {
    setPending(null);
  }, [path, win.cited?.start, win.cited?.end]);

  // Cmd/Ctrl+F opens the in-file find bar instead of the browser's native one
  // (which can't see the cited-band rows or token spans). Cmd/Ctrl+G hops to
  // the next match (Shift to go back) even while the bar is unfocused, so the
  // browser's native find-again is preserved against our scoped matches. Esc
  // closes + clears.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setFindOpen(true);
        requestAnimationFrame(() => findInputRef.current?.focus());
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        setFindOpen(true);
        stepHit(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape' && findOpen) {
        setFindOpen(false);
        setQuery('');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [findOpen, hitCount, activeHit]);

  // Scroll the active match into view when it changes. The active hit's row
  // carries id=cm-find-active so we can target it without a ref-per-line.
  useEffect(() => {
    if (!findOpen || hitCount === 0) return;
    const el = document.getElementById('cm-find-active');
    if (!el) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [findOpen, activeHit, hitCount]);

  function stepHit(dir: 1 | -1) {
    if (hitCount === 0) return;
    const next = (activeHit + dir + hitCount) % hitCount;
    // Wrap toast: stepping past the ends loops, which is easy to miss in a
    // long file. A brief note confirms we cycled rather than dead-ended.
    if (hitCount > 1 && dir === 1 && next < activeHit) {
      toast({ tone: 'info', title: `Wrapped to first of ${hitCount} matches` });
    } else if (hitCount > 1 && dir === -1 && next > activeHit) {
      toast({ tone: 'info', title: `Wrapped to last of ${hitCount} matches` });
    }
    setActiveHit(next);
  }

  function toggleWrap() {
    setWrap((w) => {
      const next = !w;
      writeWrapPref(path, next);
      return next;
    });
  }

  // Clicking a gutter line number selects that line and copies a shareable
  // permalink, so a reader can deep-link to ANY line, not just the cited band
  // the viewer happened to open on. A shift-click extends the current cited
  // band into a range. The selection round-trips through the same ?start=&end=
  // query the citation deep-link uses, so the viewer re-renders with the new
  // band highlighted + auto-scrolled. The clipboard write is best-effort:
  // navigation happens regardless, and a blocked clipboard just skips the copy
  // toast (the URL bar still reflects the selection).
  function selectLine(lineNo: number, shift: boolean) {
    const sel = lineSelection(lineNo, win.cited, shift);
    setPending(sel);
    router.push(lineLinkHref(path, sel), { scroll: false });
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof window !== 'undefined') {
      const url = linePermalink(window.location.origin, path, sel);
      navigator.clipboard.writeText(url).then(
        () =>
          toast({
            tone: 'success',
            title: `Link to ${lineRangeLabel(sel)} copied`,
            description: 'Paste anywhere to point a reader at exactly these lines.',
          }),
        () => {
          /* clipboard blocked (non-secure context): selection still applied */
        },
      );
    }
  }

  if (lines.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--cm-muted)', fontSize: 14 }}>
        File is empty.
      </div>
    );
  }

  // The active hit's line, so a row can mark its in-line span as the live one.
  const activeLine = hitCount > 0 ? hits[activeHit]?.line ?? -1 : -1;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '1px solid var(--cm-border)',
          background: 'var(--cm-paper)',
        }}
      >
        {findOpen && (
          <FindBar
            ref={findInputRef}
            query={query}
            onQuery={(v) => {
              setQuery(v);
              setActiveHit(0);
            }}
            count={hitCount}
            active={hitCount === 0 ? 0 : activeHit + 1}
            onStep={stepHit}
            onClose={() => {
              setFindOpen(false);
              setQuery('');
            }}
          />
        )}
        <button
          type="button"
          onClick={() => {
            setFindOpen(true);
            requestAnimationFrame(() => findInputRef.current?.focus());
          }}
          title="Find in file (Cmd/Ctrl+F)"
          aria-label="Find in file"
          className="cm-mono"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 9px',
            borderRadius: 999,
            fontSize: 11,
            cursor: 'pointer',
            color: findOpen ? 'var(--cm-accent-ink)' : 'var(--cm-muted)',
            background: findOpen ? 'var(--cm-accent-soft)' : 'var(--cm-subtle)',
            border: `1px solid ${findOpen ? 'var(--cm-accent-line)' : 'var(--cm-border)'}`,
          }}
        >
          <IconSearch size={12} />
          Find
        </button>
        <button
          type="button"
          onClick={toggleWrap}
          role="switch"
          aria-checked={wrap}
          aria-label="Toggle soft-wrap for long lines"
          title={wrap ? 'Long lines wrap (click to scroll)' : 'Long lines scroll (click to wrap)'}
          className="cm-mono"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 9px',
            borderRadius: 999,
            fontSize: 11,
            cursor: 'pointer',
            color: wrap ? 'var(--cm-accent-ink)' : 'var(--cm-muted)',
            background: wrap ? 'var(--cm-accent-soft)' : 'var(--cm-subtle)',
            border: `1px solid ${wrap ? 'var(--cm-accent-line)' : 'var(--cm-border)'}`,
            transition: 'color 120ms ease, background 120ms ease, border-color 120ms ease',
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18" />
            <path d="M3 12h15a3 3 0 0 1 0 6h-4" />
            <path d="m16 16-2 2 2 2" />
            <path d="M3 18h7" />
          </svg>
          {wrap ? 'Wrap' : 'Scroll'}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '14px 0',
          overflowX: wrap ? 'visible' : 'auto',
          fontSize: 13,
          lineHeight: 1.55,
          fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
        }}
      >
        {lines.map((line, i) => {
          const lineNo = startLine + i;
          const cited = isCitedLine(win, lineNo);
          const firstCited = cited && (i === 0 || !isCitedLine(win, lineNo - 1));
          const lastCited = cited && (i === lines.length - 1 || !isCitedLine(win, lineNo + 1));
          // Optimistic wash: rows in the just-clicked selection that aren't
          // already cited light up instantly while the nav round-trips, so a
          // plain-file line (no citation) still confirms the click.
          const sel = !cited && pending && lineNo >= pending.start && lineNo <= pending.end;
          const tokens = highlighted?.[i];
          // While a find query is active, render hits as <mark> over the raw
          // line; the active hit's line gets the anchor + a stronger mark.
          const searching = query.trim().length > 0;
          const rowActive = lineNo === activeLine;
          return (
            <div
              key={i}
              id={firstCited ? 'cm-cited' : lastCited ? 'cm-cited-end' : undefined}
              className={cited ? 'cm-cited-line' : sel ? 'cm-selected-line' : undefined}
              style={{ display: 'flex', alignItems: 'flex-start' }}
            >
              <button
                type="button"
                onClick={(e) => selectLine(lineNo, e.shiftKey)}
                title={`Copy a link to line ${lineNo} (shift-click to extend the range)`}
                aria-label={`Copy a permalink to line ${lineNo}`}
                className="cm-line-no"
                style={{
                  flex: '0 0 56px',
                  textAlign: 'right',
                  paddingRight: 12,
                  border: 'none',
                  background: 'transparent',
                  font: 'inherit',
                  cursor: 'pointer',
                  color: cited ? 'var(--cm-cite)' : sel ? 'var(--cm-accent)' : 'var(--cm-muted)',
                  userSelect: 'none',
                }}
              >
                {lineNo}
              </button>
              <span
                style={{
                  whiteSpace: wrap ? 'pre-wrap' : 'pre',
                  overflowWrap: wrap ? 'anywhere' : 'normal',
                  paddingRight: 16,
                  minWidth: 0,
                }}
              >
                {searching ? (
                  <FindLine line={line} query={query} markActive={rowActive} />
                ) : tokens ? (
                  tokens.map((t, k) => (
                    <span key={k} style={t.type === 'plain' ? undefined : { color: TOKEN_COLOR[t.type] }}>
                      {t.text}
                    </span>
                  ))
                ) : (
                  line || ' '
                )}
              </span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}

// A single line rendered with case-insensitive find hits wrapped in <mark>.
// The first hit on the active line carries id=cm-find-active so the viewer can
// scroll it into view; that mark also reads slightly hotter to anchor the eye.
function FindLine({ line, query, markActive }: { line: string; query: string; markActive: boolean }) {
  const needle = query.toLowerCase();
  if (!needle) return <>{line || ' '}</>;
  const hay = line.toLowerCase();
  const out: React.ReactNode[] = [];
  let from = 0;
  let first = true;
  for (;;) {
    const idx = hay.indexOf(needle, from);
    if (idx === -1) break;
    if (idx > from) out.push(line.slice(from, idx));
    const isAnchor = markActive && first;
    out.push(
      <mark
        key={idx}
        id={isAnchor ? 'cm-find-active' : undefined}
        className="cm-hi"
        style={isAnchor ? { background: 'var(--cm-accent-soft)', boxShadow: 'inset 0 -1px 0 var(--cm-accent-line)' } : undefined}
      >
        {line.slice(idx, idx + needle.length)}
      </mark>,
    );
    first = false;
    from = idx + needle.length;
  }
  if (from < line.length) out.push(line.slice(from));
  return <>{out.length ? out : line || ' '}</>;
}

// The find control bar: a search input, live count, and prev/next steppers.
// Enter advances, Shift+Enter goes back, Esc closes (handled by parent too).
const FindBar = forwardRef<
  HTMLInputElement,
  {
    query: string;
    onQuery: (v: string) => void;
    count: number;
    active: number;
    onStep: (dir: 1 | -1) => void;
    onClose: () => void;
  }
>(function FindBar({ query, onQuery, count, active, onStep, onClose }, ref) {
  const has = query.trim().length > 0;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        marginRight: 'auto',
        padding: '2px 6px 2px 10px',
        borderRadius: 999,
        background: 'var(--cm-subtle)',
        border: '1px solid var(--cm-border)',
      }}
    >
      <IconSearch size={12} />
      <input
        ref={ref}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onStep(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Find in file"
        spellCheck={false}
        aria-label="Find in file"
        style={{
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--cm-fg)',
          fontFamily: 'var(--cm-font-mono, monospace)',
          fontSize: 12,
          width: 160,
        }}
      />
      <span className="cm-mono" style={{ fontSize: 11, color: has && count === 0 ? 'var(--cm-danger)' : 'var(--cm-faint)', minWidth: 44, textAlign: 'right' }}>
        {has ? `${count === 0 ? 0 : active}/${count}` : '0/0'}
      </span>
      <button type="button" onClick={() => onStep(-1)} disabled={count === 0} aria-label="Previous match" className="cm-mono" style={stepBtn}>&#8593;</button>
      <button type="button" onClick={() => onStep(1)} disabled={count === 0} aria-label="Next match" className="cm-mono" style={stepBtn}>&#8595;</button>
      <button type="button" onClick={onClose} aria-label="Close find" className="cm-mono" style={stepBtn}>&#215;</button>
    </div>
  );
});

const stepBtn: React.CSSProperties = {
  border: '1px solid var(--cm-border)',
  background: 'var(--cm-paper)',
  borderRadius: 6,
  width: 22,
  height: 22,
  fontSize: 12,
  color: 'var(--cm-muted)',
  cursor: 'pointer',
  lineHeight: 1,
};
