'use client';
import { useMemo } from 'react';
import { highlight, langForPath, type Token, type TokenType } from '@/lib/highlight';
import { isCitedLine, type ContextWindow } from '@/lib/contextWindow';

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

  if (lines.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--cm-muted)', fontSize: 14 }}>
        File is empty.
      </div>
    );
  }

  return (
    <pre
      style={{
        margin: 0,
        padding: '14px 0',
        overflowX: 'auto',
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
            style={{ display: 'flex' }}
          >
            <span
              style={{
                flex: '0 0 56px',
                textAlign: 'right',
                paddingRight: 12,
                color: cited ? 'var(--cm-cite)' : 'var(--cm-muted)',
                userSelect: 'none',
              }}
            >
              {lineNo}
            </span>
            <span style={{ whiteSpace: 'pre', paddingRight: 16 }}>
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
  );
}
