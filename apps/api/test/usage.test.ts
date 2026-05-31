import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordUsage, getUsage, enforceQuota, periodOf, nextResetMs, DEFAULT_FREE_LIMIT,
} from '../src/services/usage.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-usage-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('usage service', () => {
  it('returns zero usage for a fresh user', async () => {
    const s = await getUsage(dir, 'u1');
    expect(s.used).toBe(0);
    expect(s.limit).toBe(DEFAULT_FREE_LIMIT);
    expect(s.remaining).toBe(DEFAULT_FREE_LIMIT);
    expect(s.byKind).toEqual({ ask: 0, search: 0 });
    expect(s.plan).toBe('free');
  });

  it('records and aggregates events for the current month', async () => {
    const now = Date.UTC(2026, 4, 15, 12, 0, 0);
    await recordUsage(dir, 'u1', 'ask', 1, now);
    await recordUsage(dir, 'u1', 'ask', 1, now + 1);
    await recordUsage(dir, 'u1', 'search', 1, now + 2);
    await recordUsage(dir, 'u2', 'ask', 1, now + 3);
    const s = await getUsage(dir, 'u1', now + 4);
    expect(s.used).toBe(3);
    expect(s.byKind.ask).toBe(2);
    expect(s.byKind.search).toBe(1);
    expect(s.remaining).toBe(DEFAULT_FREE_LIMIT - 3);
  });

  it('excludes events from previous months', async () => {
    const lastMonth = Date.UTC(2026, 3, 20);
    const thisMonth = Date.UTC(2026, 4, 5);
    await recordUsage(dir, 'u1', 'ask', 1, lastMonth);
    await recordUsage(dir, 'u1', 'ask', 1, thisMonth);
    const s = await getUsage(dir, 'u1', thisMonth);
    expect(s.used).toBe(1);
  });

  it('enforceQuota allows when under limit and blocks when over', async () => {
    const now = Date.UTC(2026, 4, 10);
    const limit = 3;
    let res = await enforceQuota(dir, 'u1', 1, now, limit);
    expect(res.allowed).toBe(true);
    await recordUsage(dir, 'u1', 'ask', 3, now);
    res = await enforceQuota(dir, 'u1', 1, now + 1, limit);
    expect(res.allowed).toBe(false);
    expect(res.summary.remaining).toBe(0);
  });

  it('periodOf and nextResetMs roll to first of next month UTC', () => {
    const t = Date.UTC(2026, 4, 31, 23, 59, 59);
    expect(periodOf(t)).toBe('2026-05');
    expect(nextResetMs(t)).toBe(Date.UTC(2026, 5, 1, 0, 0, 0));
  });
});
