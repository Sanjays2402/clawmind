import { describe, it, expect } from 'vitest';
import type { ManifestEntry } from '@clawmind/store';
import { findStaleFromEntries, DEFAULT_STALE_DAYS } from '../src/services/stale.js';

const DAY = 86_400_000;
const NOW = 1_000_000_000_000; // arbitrary fixed clock

function entry(path: string, ageDays: number, extra: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    path,
    hash: 'h',
    mtime: NOW - ageDays * DAY,
    size: 1024,
    documentId: `doc-${path}`,
    chunkCount: 3,
    ingestedAt: NOW - ageDays * DAY,
    ...extra,
  };
}

describe('findStaleSources', () => {
  it('returns nothing when no entry exceeds the threshold', () => {
    const out = findStaleFromEntries(
      [entry('/a.md', 1), entry('/b.md', 5)],
      { thresholdDays: 30, now: NOW },
    );
    expect(out.total).toBe(0);
    expect(out.items).toEqual([]);
  });

  it('selects entries strictly older than the threshold', () => {
    const out = findStaleFromEntries(
      [
        entry('/fresh.md', 1),
        entry('/edge.md', 30),    // exactly at threshold: ingestedAt > cutoff is false, so stale
        entry('/stale.md', 60),
        entry('/ancient.md', 400),
      ],
      { thresholdDays: 30, now: NOW },
    );
    // /edge.md: ingestedAt == cutoff, predicate is `ingestedAt > cutoff`,
    // so it counts as stale (boundary inclusive on the old side).
    expect(out.items.map((i) => i.path)).toEqual(['/ancient.md', '/stale.md', '/edge.md']);
  });

  it('sorts oldest first and computes ageDays', () => {
    const out = findStaleFromEntries(
      [entry('/a.md', 100), entry('/b.md', 200), entry('/c.md', 50)],
      { thresholdDays: 10, now: NOW },
    );
    expect(out.items.map((i) => i.path)).toEqual(['/b.md', '/a.md', '/c.md']);
    expect(out.items[0]?.ageDays).toBe(200);
  });

  it('applies the limit to truncate items but reports the full total', () => {
    const entries = Array.from({ length: 25 }, (_, i) => entry(`/f${i}.md`, 60 + i));
    const out = findStaleFromEntries(entries, { thresholdDays: 30, now: NOW, limit: 5 });
    expect(out.total).toBe(25);
    expect(out.items).toHaveLength(5);
  });

  it('defaults to a 30-day threshold', () => {
    const out = findStaleFromEntries(
      [entry('/a.md', 29), entry('/b.md', 31)],
      { now: NOW },
    );
    expect(out.thresholdDays).toBe(DEFAULT_STALE_DAYS);
    expect(out.items.map((i) => i.path)).toEqual(['/b.md']);
  });

  it('clamps absurd thresholds rather than overflowing', () => {
    const out = findStaleFromEntries(
      [entry('/a.md', 9000)],
      { thresholdDays: 1_000_000, now: NOW },
    );
    // 1,000,000-day threshold clamps to 3,650 days. An entry ingested
    // 9,000 days ago still falls past the clamped cutoff and shows up.
    expect(out.thresholdDays).toBe(3650);
    expect(out.items.map((i) => i.path)).toEqual(['/a.md']);
  });

  it('clamped threshold hides items younger than the clamp window', () => {
    const out = findStaleFromEntries(
      [entry('/young.md', 100)],
      { thresholdDays: 1_000_000, now: NOW },
    );
    expect(out.items).toEqual([]);
  });

  it('clamps negative thresholds to zero (everything is stale)', () => {
    const out = findStaleFromEntries(
      [entry('/a.md', 1), entry('/b.md', 0)],
      { thresholdDays: -5, now: NOW },
    );
    expect(out.thresholdDays).toBe(0);
    expect(out.total).toBe(2);
  });
});
