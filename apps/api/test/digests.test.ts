import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Source } from '@clawmind/types';
import {
  runDigest, loadState, listDigestsForUser, MAX_HISTORY, TOP_FOR_DIFF,
} from '../src/services/digests.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-dig-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

const src = (id: string): Source => ({
  id, path: `/${id}.md`, title: null, startLine: 1, endLine: 1,
  excerpt: id, score: 1,
});

describe('runDigest', () => {
  it('treats the first run as all-new', async () => {
    const { entry, state } = await runDigest(
      dir,
      { savedSearchId: 's1', query: 'q', userId: 'u1' },
      async () => [src('a'), src('b'), src('c')],
      1000,
    );
    expect(entry.newSources.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(entry.removedSources).toEqual([]);
    expect(state.lastRunTs).toBe(1000);
    expect(state.lastTopIds).toEqual(['a', 'b', 'c']);
    expect(state.history).toHaveLength(1);
  });

  it('diffs against the previous run', async () => {
    await runDigest(
      dir,
      { savedSearchId: 's1', query: 'q', userId: 'u1' },
      async () => [src('a'), src('b'), src('c')],
      1,
    );
    const { entry } = await runDigest(
      dir,
      { savedSearchId: 's1', query: 'q', userId: 'u1' },
      async () => [src('b'), src('c'), src('d')],
      2,
    );
    expect(entry.newSources.map((s) => s.id)).toEqual(['d']);
    expect(entry.removedSources).toEqual(['a']);
  });

  it('truncates retrieved sources to TOP_FOR_DIFF for the diff window', async () => {
    const many: Source[] = [];
    for (let i = 0; i < TOP_FOR_DIFF + 5; i++) many.push(src(`x${i}`));
    const { state, entry } = await runDigest(
      dir,
      { savedSearchId: 's1', query: 'q', userId: 'u1' },
      async () => many,
    );
    expect(state.lastTopIds).toHaveLength(TOP_FOR_DIFF);
    expect(entry.totalSources).toBe(TOP_FOR_DIFF);
  });

  it('caps history at MAX_HISTORY entries', async () => {
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      await runDigest(
        dir,
        { savedSearchId: 's1', query: 'q', userId: 'u1' },
        async () => [src(`r${i}`)],
        i,
      );
    }
    const state = (await loadState(dir, 's1'))!;
    expect(state.history.length).toBe(MAX_HISTORY);
    // newest first
    expect(state.history[0]?.ts).toBeGreaterThan(state.history[state.history.length - 1]!.ts);
  });

  it('persists across reload', async () => {
    await runDigest(
      dir,
      { savedSearchId: 's2', query: 'q', userId: 'u1' },
      async () => [src('a')],
    );
    const reloaded = await loadState(dir, 's2');
    expect(reloaded?.savedSearchId).toBe('s2');
    expect(reloaded?.lastTopIds).toEqual(['a']);
  });

  it('listDigestsForUser only returns matching userId and ids', async () => {
    await runDigest(dir, { savedSearchId: 's1', query: 'q', userId: 'u1' }, async () => [src('a')]);
    await runDigest(dir, { savedSearchId: 's2', query: 'q', userId: 'u2' }, async () => [src('b')]);
    await runDigest(dir, { savedSearchId: 's3', query: 'q', userId: 'u1' }, async () => [src('c')]);
    const list = await listDigestsForUser(dir, 'u1', ['s1', 's2', 's3']);
    expect(list.map((s) => s.savedSearchId).sort()).toEqual(['s1', 's3']);
  });
});
