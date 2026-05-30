import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addTags, removeTags, setTags, loadTags, normalizeTag, normalizeTags,
  pathsByTag, tagsFor, buildTagFilter,
} from '../src/services/tags.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-tags-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('tag normalization', () => {
  it('lowercases and trims simple tags', () => {
    expect(normalizeTag('  ProjectX  ')).toBe('projectx');
    expect(normalizeTag('rag-prod')).toBe('rag-prod');
    expect(normalizeTag('v1.2.3')).toBe('v1.2.3');
  });

  it('rejects empty or unsafe tags', () => {
    expect(normalizeTag('')).toBeNull();
    expect(normalizeTag('-bad')).toBeNull();
    expect(normalizeTag('has space')).toBeNull();
    expect(normalizeTag('punct!')).toBeNull();
    expect(normalizeTag('a'.repeat(65))).toBeNull();
  });

  it('normalizes lists by deduping and sorting', () => {
    expect(normalizeTags(['B', 'a', 'A', 'b', 'invalid!', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('tags service', () => {
  it('starts empty', async () => {
    expect(await loadTags(dir)).toEqual({ byPath: {} });
  });

  it('sets, persists, and reloads a tag list', async () => {
    const out = await setTags(dir, '/notes/x.md', ['Alpha', 'beta', 'alpha']);
    expect(out).toEqual(['alpha', 'beta']);
    const map = await loadTags(dir);
    expect(map.byPath['/notes/x.md']).toEqual(['alpha', 'beta']);
  });

  it('addTags unions with existing tags', async () => {
    await setTags(dir, '/a.md', ['x']);
    const out = await addTags(dir, '/a.md', ['y', 'X']);
    expect(out).toEqual(['x', 'y']);
  });

  it('removeTags subtracts and clears the entry when empty', async () => {
    await setTags(dir, '/a.md', ['x', 'y']);
    await removeTags(dir, '/a.md', ['x', 'y']);
    const map = await loadTags(dir);
    expect(map.byPath['/a.md']).toBeUndefined();
  });

  it('setTags with empty list deletes the entry', async () => {
    await setTags(dir, '/a.md', ['x']);
    await setTags(dir, '/a.md', []);
    expect((await loadTags(dir)).byPath['/a.md']).toBeUndefined();
  });

  it('tagsFor returns the stored list or empty', async () => {
    const map = await loadTags(dir);
    expect(tagsFor(map, '/missing.md')).toEqual([]);
  });

  it('pathsByTag inverts the index', async () => {
    await setTags(dir, '/a.md', ['x', 'y']);
    await setTags(dir, '/b.md', ['y']);
    const map = await loadTags(dir);
    expect(pathsByTag(map)).toEqual({ x: ['/a.md'], y: ['/a.md', '/b.md'] });
  });
});

describe('buildTagFilter', () => {
  it('returns null when both filters are empty', async () => {
    const map = await loadTags(dir);
    expect(buildTagFilter(map, {})).toBeNull();
    expect(buildTagFilter(map, { includeTags: [], excludeTags: [] })).toBeNull();
  });

  it('include filter keeps only matching paths', async () => {
    await setTags(dir, '/a.md', ['x']);
    await setTags(dir, '/b.md', ['y']);
    const map = await loadTags(dir);
    const pred = buildTagFilter(map, { includeTags: ['x'] })!;
    expect(pred('/a.md')).toBe(true);
    expect(pred('/b.md')).toBe(false);
    expect(pred('/untagged.md')).toBe(false);
  });

  it('exclude filter drops any path that carries an excluded tag', async () => {
    await setTags(dir, '/a.md', ['x']);
    await setTags(dir, '/b.md', ['y']);
    const map = await loadTags(dir);
    const pred = buildTagFilter(map, { excludeTags: ['y'] })!;
    expect(pred('/a.md')).toBe(true);
    expect(pred('/b.md')).toBe(false);
    expect(pred('/untagged.md')).toBe(true);
  });

  it('exclude beats include on the same path', async () => {
    await setTags(dir, '/a.md', ['x', 'y']);
    const map = await loadTags(dir);
    const pred = buildTagFilter(map, { includeTags: ['x'], excludeTags: ['y'] })!;
    expect(pred('/a.md')).toBe(false);
  });

  it('ignores unsafe tag tokens from the query', async () => {
    await setTags(dir, '/a.md', ['x']);
    const map = await loadTags(dir);
    const pred = buildTagFilter(map, { includeTags: ['has space', 'x'] })!;
    expect(pred('/a.md')).toBe(true);
  });
});
