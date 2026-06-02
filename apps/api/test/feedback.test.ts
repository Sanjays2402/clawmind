import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadFeedback, recordVote, clearVote, boostFor, applyBoosts, FEEDBACK_BOUNDS, getFeedback,
} from '../src/services/feedback.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-fb-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('feedback service', () => {
  it('returns empty map on first load', async () => {
    expect(await loadFeedback(dir)).toEqual({});
  });

  it('records an upvote and persists it', async () => {
    await recordVote(dir, 'u1', '/a.md', 1);
    const map = await loadFeedback(dir);
    expect(map['/a.md']?.ups).toBe(1);
    expect(map['/a.md']?.downs).toBe(0);
  });

  it('flipping vote replaces, does not stack', async () => {
    await recordVote(dir, 'u1', '/a.md', 1);
    await recordVote(dir, 'u1', '/a.md', -1);
    const map = await loadFeedback(dir);
    expect(map['/a.md']?.ups).toBe(0);
    expect(map['/a.md']?.downs).toBe(1);
  });

  it('multiple users stack', async () => {
    await recordVote(dir, 'u1', '/a.md', 1);
    await recordVote(dir, 'u2', '/a.md', 1);
    await recordVote(dir, 'u3', '/a.md', -1);
    const map = await loadFeedback(dir);
    expect(map['/a.md']?.ups).toBe(2);
    expect(map['/a.md']?.downs).toBe(1);
  });

  it('clearVote removes the user vote and the entry if empty', async () => {
    await recordVote(dir, 'u1', '/a.md', 1);
    await clearVote(dir, 'u1', '/a.md');
    const map = await loadFeedback(dir);
    expect(map['/a.md']).toBeUndefined();
  });

  it('clearVote no-ops on unknown path', async () => {
    await clearVote(dir, 'u1', '/missing.md');
    expect(await loadFeedback(dir)).toEqual({});
  });

  it('getFeedback returns the entry for a voted path', async () => {
    await recordVote(dir, 'u1', '/a.md', 1);
    const entry = await getFeedback(dir, '/a.md');
    expect(entry?.path).toBe('/a.md');
    expect(entry?.ups).toBe(1);
  });

  it('getFeedback returns null for an unvoted path', async () => {
    await recordVote(dir, 'u1', '/a.md', 1);
    expect(await getFeedback(dir, '/b.md')).toBeNull();
  });

  it('getFeedback returns null on an empty store', async () => {
    expect(await getFeedback(dir, '/anything.md')).toBeNull();
  });
});

describe('boostFor', () => {
  it('is 1 for missing entry', () => {
    expect(boostFor(undefined)).toBe(1);
  });
  it('rises with ups and falls with downs', () => {
    expect(boostFor({ path: 'x', ups: 4, downs: 0, updatedAt: 0, byUser: {} })).toBeGreaterThan(1);
    expect(boostFor({ path: 'x', ups: 0, downs: 4, updatedAt: 0, byUser: {} })).toBeLessThan(1);
  });
  it('is clamped to [MIN_BOOST, MAX_BOOST]', () => {
    expect(boostFor({ path: 'x', ups: 1000, downs: 0, updatedAt: 0, byUser: {} }))
      .toBe(FEEDBACK_BOUNDS.MAX_BOOST);
    expect(boostFor({ path: 'x', ups: 0, downs: 1000, updatedAt: 0, byUser: {} }))
      .toBe(FEEDBACK_BOUNDS.MIN_BOOST);
  });
});

describe('applyBoosts', () => {
  it('reorders items by boosted score', () => {
    const items = [
      { path: '/a.md', score: 0.6 },
      { path: '/b.md', score: 0.5 },
    ];
    const map = {
      '/b.md': { path: '/b.md', ups: 10, downs: 0, updatedAt: 0, byUser: {} },
    };
    const out = applyBoosts(items, map);
    expect(out[0]?.path).toBe('/b.md');
  });

  it('returns input unchanged when map is empty', () => {
    const items = [{ path: '/a.md', score: 1 }];
    expect(applyBoosts(items, {})).toBe(items);
  });
});
