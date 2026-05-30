import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordHistory,
  listHistory,
  pruneHistory,
  matchesHistoryFilter,
  type HistoryItem,
} from '../src/services/history.js';

function item(over: Partial<HistoryItem>): HistoryItem {
  return {
    id: over.id ?? 'i1',
    ts: over.ts ?? Date.now(),
    userId: over.userId ?? 'u1',
    query: over.query ?? 'hello',
    answer: over.answer ?? 'world',
    sources: over.sources ?? [],
    model: over.model ?? 'm',
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-hist-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('matchesHistoryFilter', () => {
  it('filters by since / until window', () => {
    const i = item({ ts: 1000 });
    expect(matchesHistoryFilter(i, { since: 500 })).toBe(true);
    expect(matchesHistoryFilter(i, { since: 1500 })).toBe(false);
    expect(matchesHistoryFilter(i, { until: 1500 })).toBe(true);
    expect(matchesHistoryFilter(i, { until: 500 })).toBe(false);
  });

  it('filters by case-insensitive substring on query or answer', () => {
    const i = item({ query: 'How do I export?', answer: 'Use the CLI.' });
    expect(matchesHistoryFilter(i, { q: 'export' })).toBe(true);
    expect(matchesHistoryFilter(i, { q: 'cli' })).toBe(true);
    expect(matchesHistoryFilter(i, { q: 'apple' })).toBe(false);
  });

  it('filters by source namespaces', () => {
    const i = item({ sources: [{ namespace: 'docs' }, { namespace: 'memory' }] });
    expect(matchesHistoryFilter(i, { namespaces: ['docs'] })).toBe(true);
    expect(matchesHistoryFilter(i, { namespaces: ['code'] })).toBe(false);
    expect(matchesHistoryFilter(i, { namespaces: ['code', 'memory'] })).toBe(true);
  });
});

describe('listHistory', () => {
  it('returns newest first and respects limit', async () => {
    await recordHistory(dir, item({ id: 'a', ts: 100 }));
    await recordHistory(dir, item({ id: 'b', ts: 300 }));
    await recordHistory(dir, item({ id: 'c', ts: 200 }));
    const got = await listHistory(dir, 'u1');
    expect(got.map((g) => g.id)).toEqual(['b', 'c', 'a']);
    const capped = await listHistory(dir, 'u1', { limit: 2 });
    expect(capped.map((g) => g.id)).toEqual(['b', 'c']);
  });

  it('isolates users from each other', async () => {
    await recordHistory(dir, item({ id: 'a', userId: 'u1' }));
    await recordHistory(dir, item({ id: 'b', userId: 'u2' }));
    const got = await listHistory(dir, 'u1');
    expect(got.map((g) => g.id)).toEqual(['a']);
  });

  it('returns empty list when log is absent', async () => {
    const got = await listHistory(dir, 'u1');
    expect(got).toEqual([]);
  });

  it('applies since / until / namespaces / q together', async () => {
    await recordHistory(dir, item({ id: 'old', ts: 100, query: 'docs question', sources: [{ namespace: 'docs' }] }));
    await recordHistory(dir, item({ id: 'new', ts: 500, query: 'code question', sources: [{ namespace: 'code' }] }));
    const got = await listHistory(dir, 'u1', {
      since: 200, namespaces: ['code'], q: 'question',
    });
    expect(got.map((g) => g.id)).toEqual(['new']);
  });
});

describe('pruneHistory', () => {
  it('removes entries older than `before`', async () => {
    await recordHistory(dir, item({ id: 'a', ts: 100 }));
    await recordHistory(dir, item({ id: 'b', ts: 300 }));
    await recordHistory(dir, item({ id: 'c', ts: 500 }));
    const res = await pruneHistory(dir, 'u1', { before: 250 });
    expect(res).toEqual({ removed: 1, kept: 2 });
    const remaining = await listHistory(dir, 'u1');
    expect(remaining.map((r) => r.id)).toEqual(['c', 'b']);
  });

  it('honours keepPerUser, keeping newest entries', async () => {
    for (let t = 1; t <= 5; t++) {
      await recordHistory(dir, item({ id: `i${t}`, ts: t * 100 }));
    }
    const res = await pruneHistory(dir, 'u1', { keepPerUser: 2 });
    expect(res.kept).toBe(2);
    expect(res.removed).toBe(3);
    const remaining = await listHistory(dir, 'u1');
    expect(remaining.map((r) => r.id)).toEqual(['i5', 'i4']);
  });

  it('does not touch other users', async () => {
    await recordHistory(dir, item({ id: 'mine', userId: 'u1', ts: 100 }));
    await recordHistory(dir, item({ id: 'theirs', userId: 'u2', ts: 100 }));
    await pruneHistory(dir, 'u1', { before: 500 });
    const other = await listHistory(dir, 'u2');
    expect(other.map((o) => o.id)).toEqual(['theirs']);
  });

  it('returns zero counts when no options supplied', async () => {
    await recordHistory(dir, item({ id: 'a', ts: 100 }));
    const res = await pruneHistory(dir, 'u1', {});
    expect(res).toEqual({ removed: 0, kept: 0 });
  });

  it('writes a well-formed log after pruning', async () => {
    await recordHistory(dir, item({ id: 'a', ts: 100 }));
    await recordHistory(dir, item({ id: 'b', ts: 200 }));
    await pruneHistory(dir, 'u1', { before: 150 });
    const raw = readFileSync(join(dir, 'history.jsonl'), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).id).toBe('b');
  });
});
