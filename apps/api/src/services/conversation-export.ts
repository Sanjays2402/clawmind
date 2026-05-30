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
