import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizeTags,
  loadMap,
  setTags,
  addTags,
  removeTags,
  tagsFor,
  listUserTags,
  forgetItem,
} from '../src/services/history-tags.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-htags-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('normalizeTags', () => {
  it('lowercases, trims, dedups, sorts, and drops bad input', () => {
    const out = normalizeTags(['Travel', ' work ', 'TRAVEL', '', '!!!', 'a'.repeat(64), 'note-1']);
    expect(out).toEqual(['note-1', 'travel', 'work']);
  });

  it('caps the per-item tag list size', () => {
    const many = Array.from({ length: 40 }, (_, i) => `t${i}`);
    expect(normalizeTags(many).length).toBe(16);
  });
});

describe('setTags / addTags / removeTags', () => {
  it('persists tags, isolates them per user and item, and reloads cleanly', async () => {
    await setTags(dir, 'alice', 'h1', ['Travel', 'work']);
    await addTags(dir, 'alice', 'h1', ['research']);
    await setTags(dir, 'bob', 'h1', ['private']);

    const map = await loadMap(dir);
    expect(tagsFor(map, 'alice', 'h1')).toEqual(['research', 'travel', 'work']);
    expect(tagsFor(map, 'bob', 'h1')).toEqual(['private']);
    expect(tagsFor(map, 'alice', 'h2')).toEqual([]);

    await removeTags(dir, 'alice', 'h1', ['work']);
    const map2 = await loadMap(dir);
    expect(tagsFor(map2, 'alice', 'h1')).toEqual(['research', 'travel']);

    expect(listUserTags(map2, 'alice')).toEqual(['research', 'travel']);
    expect(listUserTags(map2, 'bob')).toEqual(['private']);
  });

  it('removes the entry entirely when the last tag is cleared', async () => {
    await setTags(dir, 'alice', 'h1', ['solo']);
    await setTags(dir, 'alice', 'h1', []);
    const map = await loadMap(dir);
    expect(tagsFor(map, 'alice', 'h1')).toEqual([]);
    expect(map.byUser.alice).toBeUndefined();
  });

  it('forgetItem drops one item without touching siblings', async () => {
    await setTags(dir, 'alice', 'h1', ['a']);
    await setTags(dir, 'alice', 'h2', ['b']);
    await forgetItem(dir, 'alice', 'h1');
    const map = await loadMap(dir);
    expect(tagsFor(map, 'alice', 'h1')).toEqual([]);
    expect(tagsFor(map, 'alice', 'h2')).toEqual(['b']);
  });
});
