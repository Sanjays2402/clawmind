'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@clawmind/ui';
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

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '6px 12px',
          borderBottom: '1px solid var(--cm-border)',
          background: 'var(--cm-paper)',
        }}
      >
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
          const tokens = highlighted?.[i];
          return (
            <div
              key={i}
              id={firstCited ? 'cm-cited' : undefined}
              className={cited ? 'cm-cited-line' : undefined}
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
                  color: cited ? 'var(--cm-cite)' : 'var(--cm-muted)',
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
                {tokens ? (
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
