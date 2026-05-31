import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizeTitle,
  loadMap,
  setTitle,
  titleFor,
  forgetItem,
} from '../src/services/history-titles.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-htitles-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('normalizeTitle', () => {
  it('trims, collapses whitespace, strips controls, and caps length', () => {
    expect(normalizeTitle('  hello   world\n')).toBe('hello world');
    expect(normalizeTitle('one\ttwo\u0007three')).toBe('one two three');
    expect(normalizeTitle('a'.repeat(500)).length).toBe(120);
  });

  it('rejects non-strings and pure-whitespace input', () => {
    expect(normalizeTitle(undefined)).toBe('');
    expect(normalizeTitle(42)).toBe('');
    expect(normalizeTitle('   \n\t   ')).toBe('');
  });
});

describe('setTitle / titleFor / forgetItem', () => {
  it('persists per-user titles and reloads cleanly', async () => {
    await setTitle(dir, 'alice', 'h1', 'Q3 launch plan');
    await setTitle(dir, 'bob', 'h1', 'private note');

    const map = await loadMap(dir);
    expect(titleFor(map, 'alice', 'h1')).toBe('Q3 launch plan');
    expect(titleFor(map, 'bob', 'h1')).toBe('private note');
    expect(titleFor(map, 'alice', 'h2')).toBeUndefined();
  });

  it('empty title clears the entry and prunes empty user buckets', async () => {
    await setTitle(dir, 'alice', 'h1', 'first');
    await setTitle(dir, 'alice', 'h1', '');
    const map = await loadMap(dir);
    expect(titleFor(map, 'alice', 'h1')).toBeUndefined();
    expect(map.byUser.alice).toBeUndefined();
  });

  it('forgetItem drops one row without touching siblings', async () => {
    await setTitle(dir, 'alice', 'h1', 'one');
    await setTitle(dir, 'alice', 'h2', 'two');
    await forgetItem(dir, 'alice', 'h1');
    const map = await loadMap(dir);
    expect(titleFor(map, 'alice', 'h1')).toBeUndefined();
    expect(titleFor(map, 'alice', 'h2')).toBe('two');
  });

  it('writes a stable JSON document we can round-trip by hand', async () => {
    await setTitle(dir, 'alice', 'h1', '  spaced   out  ');
    const raw = readFileSync(join(dir, 'history-titles.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.byUser.alice.h1).toBe('spaced out');
  });
});
