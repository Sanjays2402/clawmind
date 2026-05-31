import { describe, it, expect } from 'vitest';
import { conversationToMarkdown, conversationToJson, conversationToCsv } from '../src/services/conversation-export.js';
import type { Conversation } from '../src/services/conversations.js';
import type { Source } from '@clawmind/types';

const fmt = (_ts: number) => '2026-05-29 17:00';

function src(over: Partial<Source>): Source {
  return {
    id: 'src1', path: '/abs/workspace/notes/snip.md', title: 'snip notes',
    startLine: 10, endLine: 12, excerpt: 'snip is...', score: 0.9,
    ...over,
  } as Source;
}

function conv(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1', userId: 'u1', title: 'Snip deep dive',
    createdAt: 1, updatedAt: 2, turns: [], ...over,
  };
}

describe('conversationToMarkdown', () => {
  it('renders an empty conversation with a stub body', () => {
    const md = conversationToMarkdown(conv(), { formatDate: fmt });
    expect(md).toContain('# Snip deep dive');
    expect(md).toContain('0 turns');
    expect(md).toContain('_No turns yet._');
  });

  it('renders user and assistant turns with timestamps', () => {
    const c = conv({
      turns: [
        { id: 't1', role: 'user', content: 'what is snip', ts: 100 },
        { id: 't2', role: 'assistant', content: 'snip is a thing.', ts: 200, model: 'hermes-agent' },
      ],
    });
    const md = conversationToMarkdown(c, { formatDate: fmt });
    expect(md).toContain('### You - 2026-05-29 17:00');
    expect(md).toContain('### ClawMind - 2026-05-29 17:00 (hermes-agent)');
    expect(md).toContain('snip is a thing.');
  });

  it('appends a numbered Sources block for assistant turns with sources', () => {
    const c = conv({
      turns: [
        {
          id: 't', role: 'assistant', content: 'see refs', ts: 0, model: 'm',
          sources: [
            src({ path: '/abs/workspace/a.md', startLine: 5, endLine: 5, title: 'A' }),
            src({ id: 's2', path: '/abs/workspace/b.md', startLine: 10, endLine: 22, title: null }),
          ],
        },
      ],
    });
    const md = conversationToMarkdown(c, { formatDate: fmt, stripBasePath: '/abs/workspace' });
    expect(md).toContain('**Sources**');
    expect(md).toContain('1. [A](a.md#L5) - a.md:5');
    expect(md).toContain('2. [b.md](b.md#L10) - b.md:10-22');
  });

  it('does not render a Sources block on user turns', () => {
    const c = conv({
      turns: [{ id: 't', role: 'user', content: 'hi', ts: 0, sources: [src({})] }],
    });
    const md = conversationToMarkdown(c, { formatDate: fmt });
    expect(md).not.toContain('**Sources**');
  });

  it('preserves the trailing newline so editors do not complain', () => {
    const c = conv({ turns: [{ id: 't', role: 'user', content: 'x', ts: 0 }] });
    const md = conversationToMarkdown(c, { formatDate: fmt });
    expect(md.endsWith('\n')).toBe(true);
  });
});

describe('conversationToJson', () => {
  it('emits a versioned envelope with normalized turn data', () => {
    const c = conv({
      turns: [
        { id: 'u', role: 'user', content: 'hi', ts: 100 },
        {
          id: 'a',
          role: 'assistant',
          content: 'hello',
          ts: 200,
          model: 'hermes-agent',
          sources: [src({ id: 's1', path: '/abs/workspace/a.md', title: 'A', startLine: 5, endLine: 5 })],
        },
      ],
    });
    const out = conversationToJson(c, { stripBasePath: '/abs/workspace' });
    expect(out.version).toBe(1);
    expect(out.conversation.id).toBe('c1');
    expect(out.conversation.turns).toHaveLength(2);
    const assistant = out.conversation.turns[1];
    expect(assistant.model).toBe('hermes-agent');
    expect(assistant.sources?.[0].path).toBe('a.md');
    expect(out.conversation.turns[0].sources).toBeUndefined();
  });
});

describe('conversationToCsv', () => {
  it('produces an RFC 4180 row per turn with quoted content', () => {
    const c = conv({
      turns: [
        { id: 'u', role: 'user', content: 'has, comma\nand newline', ts: 0 },
        {
          id: 'a',
          role: 'assistant',
          content: 'plain answer',
          ts: 1000,
          model: 'm',
          sources: [
            src({ id: 's1', path: '/abs/workspace/a.md', startLine: 1, endLine: 1, title: null }),
            src({ id: 's2', path: '/abs/workspace/b.md', startLine: 2, endLine: 3, title: null }),
          ],
        },
      ],
    });
    const csv = conversationToCsv(c, { stripBasePath: '/abs/workspace' });
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('turn_id,role,ts_iso,model,content,source_paths');
    expect(csv).toContain('"has, comma\nand newline"');
    expect(csv).toContain('a.md:1 | b.md:2-3');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});
