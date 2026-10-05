import { describe, it, expect } from 'vitest';
import {
  parseThread,
  serializeThread,
  sanitizeTurn,
  INTERRUPTED_MESSAGE,
  MAX_TURNS,
  THREAD_VERSION,
  type StoredTurn,
} from '../src/lib/threadStore';

const turn = (id: string, over: Partial<StoredTurn> = {}): StoredTurn => ({
  id,
  question: `question ${id}`,
  answer: `answer ${id} [1]`,
  sources: [{ id: `s-${id}`, path: `/notes/${id}.md`, startLine: 3, endLine: 9, excerpt: 'x', score: 0.8 }],
  error: null,
  done: true,
  tokens: 42,
  elapsedMs: 1200,
  ...over,
});

describe('threadStore', () => {
  it('round-trips a thread through serialize/parse', () => {
    const turns = [turn('b'), turn('a')];
    expect(parseThread(serializeThread(turns))).toEqual(turns);
  });

  it('drops snippet spans when serializing', () => {
    const t = turn('a');
    const withSnippet = {
      ...t,
      sources: [{ ...t.sources[0]!, snippet: { text: 'x', spans: [{ start: 0, end: 1 }] } }],
    } as unknown as StoredTurn;
    expect(serializeThread([withSnippet])).not.toContain('snippet');
  });

  it('returns null for absent, malformed, or wrong-version payloads', () => {
    expect(parseThread(null)).toBeNull();
    expect(parseThread('not json')).toBeNull();
    expect(parseThread(JSON.stringify([turn('a')]))).toBeNull();
    expect(parseThread(JSON.stringify({ v: THREAD_VERSION + 1, turns: [turn('a')] }))).toBeNull();
    expect(parseThread(JSON.stringify({ v: THREAD_VERSION, turns: [] }))).toBeNull();
  });

  it('closes out a turn that was still streaming when saved', () => {
    const t = sanitizeTurn({ ...turn('a'), done: false, error: null, tokens: 5 });
    expect(t?.done).toBe(true);
    expect(t?.error).toBe(INTERRUPTED_MESSAGE);
    expect(t?.tokens).toBeUndefined();
  });

  it('keeps an existing error rather than overwriting it', () => {
    expect(sanitizeTurn({ ...turn('a'), done: false, error: 'boom' })?.error).toBe('boom');
  });

  it('rejects turns without an id or question and filters bad sources', () => {
    expect(sanitizeTurn({ question: 'q' })).toBeNull();
    expect(sanitizeTurn({ id: 'a', question: '   ' })).toBeNull();
    const t = sanitizeTurn({ id: 'a', question: 'q', sources: [{ id: 's', path: '/p' }, { nope: 1 }, 'x'] });
    expect(t?.sources).toEqual([{ id: 's', path: '/p', startLine: 1, endLine: 1, excerpt: '', score: 0 }]);
  });

  it('caps the stored thread at MAX_TURNS, newest first', () => {
    const many = Array.from({ length: MAX_TURNS + 5 }, (_, i) => turn(String(i)));
    const parsed = parseThread(serializeThread(many));
    expect(parsed).toHaveLength(MAX_TURNS);
    expect(parsed?.[0]?.id).toBe('0');
  });
});
