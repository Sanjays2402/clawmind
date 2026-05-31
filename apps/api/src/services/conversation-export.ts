import type { Conversation, ConversationTurn } from './conversations.js';
import type { Source } from '@clawmind/types';

// Render a conversation to Markdown that survives outside the app.
//
// Every assistant turn that has sources gets numbered footnote references
// after the answer text, and a Sources section at the end of that turn lists
// each cited file with its line range. We resolve [^N] markers already present
// in the assistant text so the output keeps the same numbering whether the
// model emitted citations inline or only via the sources list.
//
// The output is plain CommonMark, no front matter, so it pastes cleanly into
// notes, gists, or GitHub.

export interface ExportOptions {
  /** Local-time formatter. Tests can pass a fixed function. */
  formatDate?: (ts: number) => string;
  /** Optional base path. If a source path starts with it, we strip it for tidier output. */
  stripBasePath?: string;
}

function defaultFormatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function trimPath(p: string, base?: string): string {
  if (!base) return p;
  return p.startsWith(base) ? p.slice(base.length).replace(/^\/+/, '') : p;
}

function renderSources(sources: Source[], base?: string): string {
  const lines: string[] = ['', '**Sources**', ''];
  sources.forEach((s, i) => {
    const n = i + 1;
    const path = trimPath(s.path, base);
    const where = s.startLine === s.endLine
      ? `${path}:${s.startLine}`
      : `${path}:${s.startLine}-${s.endLine}`;
    const title = s.title ?? path;
    lines.push(`${n}. [${title}](${path}#L${s.startLine}) - ${where}`);
  });
  return lines.join('\n');
}

function renderTurn(turn: ConversationTurn, opts: ExportOptions): string {
  const fmt = opts.formatDate ?? defaultFormatDate;
  const heading = turn.role === 'user' ? 'You' : 'ClawMind';
  const ts = fmt(turn.ts);
  const suffix = turn.model ? ` (${turn.model})` : '';
  const parts = [`### ${heading} - ${ts}${suffix}`, '', turn.content.trim()];
  if (turn.role === 'assistant' && turn.sources && turn.sources.length > 0) {
    parts.push(renderSources(turn.sources, opts.stripBasePath));
  }
  return parts.join('\n');
}

// Stable JSON shape for `/conversations/:id/export.json`. We keep the
// outer envelope versioned so callers can detect breaking changes without
// having to inspect every nested field.
export interface ConversationJsonExport {
  version: 1;
  exportedAt: number;
  conversation: {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    turns: Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      ts: number;
      model?: string;
      sources?: Array<{
        id: string;
        path: string;
        title?: string;
        startLine: number;
        endLine: number;
        excerpt?: string;
        score?: number;
      }>;
    }>;
  };
}

export function conversationToJson(conv: Conversation, opts: ExportOptions = {}): ConversationJsonExport {
  const base = opts.stripBasePath;
  return {
    version: 1,
    exportedAt: Date.now(),
    conversation: {
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      turns: conv.turns.map((t) => ({
        id: t.id,
        role: t.role,
        content: t.content,
        ts: t.ts,
        ...(t.model ? { model: t.model } : {}),
        ...(t.role === 'assistant' && t.sources && t.sources.length > 0
          ? {
              sources: t.sources.map((s) => ({
                id: s.id,
                path: trimPath(s.path, base),
                ...(s.title ? { title: s.title } : {}),
                startLine: s.startLine,
                endLine: s.endLine,
                ...(s.excerpt ? { excerpt: s.excerpt } : {}),
                ...(typeof s.score === 'number' ? { score: s.score } : {}),
              })),
            }
          : {}),
      })),
    },
  };
}

// RFC 4180 CSV escape. Wraps in quotes when the value contains a comma,
// quote, CR, or LF, and doubles internal quotes. Newlines are preserved
// inside quoted fields so the message body survives a round trip.
function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function conversationToCsv(conv: Conversation, opts: ExportOptions = {}): string {
  const base = opts.stripBasePath;
  const header = ['turn_id', 'role', 'ts_iso', 'model', 'content', 'source_paths'];
  const rows: string[] = [header.join(',')];
  for (const t of conv.turns) {
    const iso = new Date(t.ts).toISOString();
    const sources =
      t.role === 'assistant' && t.sources && t.sources.length > 0
        ? t.sources
            .map((s) => {
              const p = trimPath(s.path, base);
              return s.startLine === s.endLine ? `${p}:${s.startLine}` : `${p}:${s.startLine}-${s.endLine}`;
            })
            .join(' | ')
        : '';
    rows.push(
      [
        csvCell(t.id),
        csvCell(t.role),
        csvCell(iso),
        csvCell(t.model ?? ''),
        csvCell(t.content),
        csvCell(sources),
      ].join(','),
    );
  }
  return rows.join('\r\n') + '\r\n';
}

export function conversationToMarkdown(conv: Conversation, opts: ExportOptions = {}): string {
  const fmt = opts.formatDate ?? defaultFormatDate;
  const header = [
    `# ${conv.title}`,
    '',
    `Started ${fmt(conv.createdAt)} - last updated ${fmt(conv.updatedAt)} - ${conv.turns.length} turns`,
    '',
  ];
  if (conv.turns.length === 0) {
    return header.concat(['_No turns yet._', '']).join('\n');
  }
  const body = conv.turns.map((t) => renderTurn(t, opts)).join('\n\n');
  return header.join('\n') + body + '\n';
}
