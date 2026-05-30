import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Source } from '@clawmind/types';
import {
  captureSnapshot, listSnapshots, loadSnapshot, deleteSnapshot,
  diffAgainstSnapshot, MAX_SNAPSHOTS_PER_QUERY, DEFAULT_SNAPSHOT_TOP,
} from '../src/services/snapshots.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-snap-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

function src(id: string, path = `/${id}.md`): Source {
  return {
    id, path, title: null, startLine: 1, endLine: 1, excerpt: id, score: 1,
  };
}

describe('snapshots service', () => {
  it('captures and reloads by id', async () => {
    const entry = await captureSnapshot(dir, {
      savedSearchId: 's1', userId: 'u1',
      sources: [src('a'), src('b')], label: 'before reindex',
    });
    expect(entry.id).toBeTruthy();
    expect(entry.label).toBe('before reindex');
    expect(entry.sources).toHaveLength(2);
    const reloaded = await loadSnapshot(dir, 's1', entry.id);
    expect(reloaded?.id).toBe(entry.id);
  });

  it('trims labels and falls back to null on empty', async () => {
    const a = await captureSnapshot(dir, {
      savedSearchId: 's1', userId: 'u1', sources: [], label: '   ',
    });
    expect(a.label).toBeNull();
    const b = await captureSnapshot(dir, {
      savedSearchId: 's1', userId: 'u1', sources: [], label: 'x'.repeat(500),
    });
    expect(b.label!.length).toBe(200);
  });

  it('truncates captured sources at DEFAULT_SNAPSHOT_TOP', async () => {
    const many = Array.from({ length: DEFAULT_SNAPSHOT_TOP + 5 }, (_, i) => src(`s${i}`));
    const entry = await captureSnapshot(dir, {
      savedSearchId: 's1', userId: 'u1', sources: many,
    });
    expect(entry.sources).toHaveLength(DEFAULT_SNAPSHOT_TOP);
  });

  it('listSnapshots returns newest first', async () => {
    const a = await captureSnapshot(dir, { savedSearchId: 's1', userId: 'u1', sources: [src('a')] });
    await new Promise((r) => setTimeout(r, 5));
    const b = await captureSnapshot(dir, { savedSearchId: 's1', userId: 'u1', sources: [src('b')] });
    const list = await listSnapshots(dir, 's1');
    expect(list.map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it('returns empty list for an unknown saved search', async () => {
    expect(await listSnapshots(dir, 'nope')).toEqual([]);
  });

  it('deleteSnapshot removes the file and is idempotent', async () => {
    const e = await captureSnapshot(dir, { savedSearchId: 's1', userId: 'u1', sources: [] });
    expect(await deleteSnapshot(dir, 's1', e.id)).toBe(true);
    expect(await deleteSnapshot(dir, 's1', e.id)).toBe(false);
    expect(await loadSnapshot(dir, 's1', e.id)).toBeNull();
  });

  it('prunes the oldest entries past MAX_SNAPSHOTS_PER_QUERY', async () => {
    // Create just over the cap; older ones should be dropped.
    const overshoot = 3;
    const ids: string[] = [];
    for (let i = 0; i < MAX_SNAPSHOTS_PER_QUERY + overshoot; i++) {
      const e = await captureSnapshot(dir, {
        savedSearchId: 's1', userId: 'u1', sources: [], label: `${i}`,
      });
      ids.push(e.id);
      // Keep timestamps monotonically increasing across boundary on fast hosts.
      if (i % 25 === 0) await new Promise((r) => setTimeout(r, 2));
    }
    const list = await listSnapshots(dir, 's1');
    expect(list.length).toBe(MAX_SNAPSHOTS_PER_QUERY);
    // The very first captures should be gone.
    const surviving = new Set(list.map((s) => s.id));
    for (let i = 0; i < overshoot; i++) {
      expect(surviving.has(ids[i]!)).toBe(false);
    }
  });
});

describe('diffAgainstSnapshot', () => {
  it('classifies added, removed, and unchanged by id', () => {
    const baseline = {
      id: 'b', savedSearchId: 's', userId: 'u', label: null, ts: 1,
      sources: [src('a'), src('b'), src('c')],
    };
    const current = [src('b'), src('c'), src('d')];
    const diff = diffAgainstSnapshot(baseline, current, 2);
    expect(diff.added.map((s) => s.id)).toEqual(['d']);
    expect(diff.removed.map((s) => s.id)).toEqual(['a']);
    expect(diff.unchanged.sort()).toEqual(['b', 'c']);
    expect(diff.baselineId).toBe('b');
    expect(diff.baselineTs).toBe(1);
    expect(diff.currentTs).toBe(2);
  });

  it('returns all-added on a fresh diff with empty baseline', () => {
    const baseline = {
      id: 'b', savedSearchId: 's', userId: 'u', label: null, ts: 0, sources: [],
    };
    const diff = diffAgainstSnapshot(baseline, [src('a'), src('b')]);
    expect(diff.added).toHaveLength(2);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  it('returns all-removed when current is empty', () => {
    const baseline = {
      id: 'b', savedSearchId: 's', userId: 'u', label: null, ts: 0,
      sources: [src('a'), src('b')],
    };
    const diff = diffAgainstSnapshot(baseline, []);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toHaveLength(2);
    expect(diff.unchanged).toEqual([]);
  });

  it('identity is by source id, not path: same path with new id counts as drift', () => {
    const baseline = {
      id: 'b', savedSearchId: 's', userId: 'u', label: null, ts: 0,
      sources: [src('chunk-old', '/x.md')],
    };
    const current = [src('chunk-new', '/x.md')];
    const diff = diffAgainstSnapshot(baseline, current);
    expect(diff.added.map((s) => s.id)).toEqual(['chunk-new']);
    expect(diff.removed.map((s) => s.id)).toEqual(['chunk-old']);
  });
});
