import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addAlias, removeAlias, loadAliases, filterAliases,
  expandQueryAliases, shortenPath, ALIAS_NAME_RE,
} from '../src/services/aliases.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-aliases-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('aliases service', () => {
  it('returns an empty map on first load', async () => {
    expect(await loadAliases(dir)).toEqual({});
  });

  it('adds and persists an alias', async () => {
    const e = await addAlias(dir, 'u1', 'notes', '/ws/notes');
    expect(e.name).toBe('notes');
    expect(e.path).toBe('/ws/notes');
    expect(e.createdBy).toBe('u1');
    expect((await loadAliases(dir))['notes']).toEqual(e);
  });

  it('strips trailing slashes from the stored path', async () => {
    const e = await addAlias(dir, 'u1', 'notes', '/ws/notes///');
    expect(e.path).toBe('/ws/notes');
  });

  it('rejects invalid names', async () => {
    await expect(addAlias(dir, 'u1', '', '/x')).rejects.toThrow(/invalid alias name/);
    await expect(addAlias(dir, 'u1', '-leading', '/x')).rejects.toThrow(/invalid alias name/);
    await expect(addAlias(dir, 'u1', 'has space', '/x')).rejects.toThrow(/invalid alias name/);
    await expect(addAlias(dir, 'u1', 'has/slash', '/x')).rejects.toThrow(/invalid alias name/);
  });

  it('rejects empty paths', async () => {
    await expect(addAlias(dir, 'u1', 'notes', '/')).rejects.toThrow(/non-empty/);
  });

  it('removeAlias returns true/false as expected', async () => {
    await addAlias(dir, 'u1', 'notes', '/ws/notes');
    expect(await removeAlias(dir, 'notes')).toBe(true);
    expect(await removeAlias(dir, 'notes')).toBe(false);
  });

  it('regex accepts common shapes and rejects others', () => {
    expect(ALIAS_NAME_RE.test('notes')).toBe(true);
    expect(ALIAS_NAME_RE.test('a1_b-c')).toBe(true);
    expect(ALIAS_NAME_RE.test('A')).toBe(true);
    expect(ALIAS_NAME_RE.test('-foo')).toBe(false);
    expect(ALIAS_NAME_RE.test('a'.repeat(33))).toBe(false);
  });
});

describe('expandQueryAliases', () => {
  const map = {
    notes: { name: 'notes', path: '/ws/notes', createdAt: 0, createdBy: 'u' },
    proj: { name: 'proj', path: '/ws/projects', createdAt: 0, createdBy: 'u' },
  };

  it('expands a bare alias token', () => {
    expect(expandQueryAliases(map, 'search @notes for x')).toBe('search /ws/notes for x');
  });

  it('expands an alias with a path suffix', () => {
    expect(expandQueryAliases(map, 'open @notes/foo.md please'))
      .toBe('open /ws/notes/foo.md please');
  });

  it('leaves unknown aliases alone', () => {
    expect(expandQueryAliases(map, 'see @unknown/x')).toBe('see @unknown/x');
  });

  it('expands multiple aliases in one query', () => {
    expect(expandQueryAliases(map, '@notes vs @proj/a'))
      .toBe('/ws/notes vs /ws/projects/a');
  });

  it('is a no-op on a string with no @ tokens', () => {
    expect(expandQueryAliases(map, 'nothing fancy here')).toBe('nothing fancy here');
  });
});

describe('shortenPath', () => {
  const map = {
    notes: { name: 'notes', path: '/ws/notes', createdAt: 0, createdBy: 'u' },
    daily: { name: 'daily', path: '/ws/notes/daily', createdAt: 0, createdBy: 'u' },
  };

  it('returns null when nothing matches', () => {
    expect(shortenPath(map, '/elsewhere/file.md')).toBeNull();
  });

  it('shortens an exact alias path', () => {
    expect(shortenPath(map, '/ws/notes')).toBe('@notes');
  });

  it('prefers the longest matching prefix', () => {
    // '/ws/notes/daily/x.md' matches both 'notes' and 'daily'; the more
    // specific one wins so the rendered label is the most informative.
    expect(shortenPath(map, '/ws/notes/daily/x.md')).toBe('@daily/x.md');
  });

  it('does not match a sibling path that shares a prefix', () => {
    expect(shortenPath(map, '/ws/notes-archive/x.md')).toBeNull();
  });
});

describe('filterAliases', () => {
  const entries = [
    { name: 'notes', path: '/ws/notes', createdAt: 1, createdBy: 'u' },
    { name: 'daily', path: '/ws/notes/daily', createdAt: 2, createdBy: 'u' },
    { name: 'projects', path: '/ws/code/projects', createdAt: 3, createdBy: 'u' },
  ];

  it('returns the input when q is empty or whitespace', () => {
    expect(filterAliases(entries, undefined)).toBe(entries);
    expect(filterAliases(entries, '')).toBe(entries);
    expect(filterAliases(entries, '   ')).toBe(entries);
  });

  it('matches a substring of the alias name case-insensitively', () => {
    const out = filterAliases(entries, 'DAILY');
    expect(out.map((e) => e.name)).toEqual(['daily']);
  });

  it('matches a substring of the target path', () => {
    const out = filterAliases(entries, '/code/');
    expect(out.map((e) => e.name)).toEqual(['projects']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterAliases(entries, 'zzz-no-hit')).toEqual([]);
  });
});
