import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addMute, removeMute, loadMutes, filterMutes, isMuted, mutePenaltyFor, MUTE_PENALTY,
} from '../src/services/mutes.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-mutes-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('mutes service', () => {
  it('returns an empty map on first load', async () => {
    expect(await loadMutes(dir)).toEqual({});
  });

  it('adds a mute and persists it', async () => {
    const entry = await addMute(dir, 'u1', '/logs/noisy.md', 'too verbose');
    expect(entry.path).toBe('/logs/noisy.md');
    expect(entry.reason).toBe('too verbose');
    expect(entry.mutedBy).toBe('u1');
    const map = await loadMutes(dir);
    expect(map['/logs/noisy.md']).toEqual(entry);
  });

  it('addMute overwrites an existing mute', async () => {
    const first = await addMute(dir, 'u1', '/a.md', 'old');
    await new Promise((r) => setTimeout(r, 2));
    const second = await addMute(dir, 'u2', '/a.md', 'new');
    expect(second.mutedAt).toBeGreaterThanOrEqual(first.mutedAt);
    expect(second.mutedBy).toBe('u2');
    expect(second.reason).toBe('new');
  });

  it('empty/whitespace reason is normalized to undefined', async () => {
    const entry = await addMute(dir, 'u1', '/a.md', '   ');
    expect(entry.reason).toBeUndefined();
  });

  it('removeMute returns true on existing, false on missing', async () => {
    await addMute(dir, 'u1', '/a.md');
    expect(await removeMute(dir, '/a.md')).toBe(true);
    expect(await removeMute(dir, '/a.md')).toBe(false);
    expect(await loadMutes(dir)).toEqual({});
  });
});

describe('isMuted', () => {
  it('matches by exact path', () => {
    const map = { '/x.md': { path: '/x.md', mutedAt: 0, mutedBy: 'u' } };
    expect(isMuted(map, '/x.md')).toBe(true);
    expect(isMuted(map, '/y.md')).toBe(false);
  });

  it('matches by directory glob "dir/**"', () => {
    const map = { '/logs/**': { path: '/logs/**', mutedAt: 0, mutedBy: 'u' } };
    expect(isMuted(map, '/logs/a.md')).toBe(true);
    expect(isMuted(map, '/logs/sub/b.md')).toBe(true);
    expect(isMuted(map, '/notes/a.md')).toBe(false);
  });

  it('does not match a sibling directory that shares a prefix', () => {
    // "/logs/**" must not match "/logs-archive/x.md" because the trailing
    // slash is preserved during the prefix comparison.
    const map = { '/logs/**': { path: '/logs/**', mutedAt: 0, mutedBy: 'u' } };
    expect(isMuted(map, '/logs-archive/x.md')).toBe(false);
  });
});

describe('mutePenaltyFor', () => {
  it('returns 1 for unmuted paths', () => {
    expect(mutePenaltyFor({}, '/x.md')).toBe(1);
  });

  it('returns MUTE_PENALTY for muted paths', () => {
    const map = { '/x.md': { path: '/x.md', mutedAt: 0, mutedBy: 'u' } };
    expect(mutePenaltyFor(map, '/x.md')).toBe(MUTE_PENALTY);
    expect(MUTE_PENALTY).toBeGreaterThan(0);
    expect(MUTE_PENALTY).toBeLessThan(1);
  });
});

describe('filterMutes', () => {
  const entries = [
    { path: '/logs/noisy.md', reason: 'too verbose', mutedAt: 1, mutedBy: 'u' },
    { path: '/notes/scratch.md', reason: 'outdated', mutedAt: 2, mutedBy: 'u' },
    { path: '/docs/api.md', mutedAt: 3, mutedBy: 'u' },
  ];

  it('returns the input when q is empty or whitespace', () => {
    expect(filterMutes(entries, undefined)).toBe(entries);
    expect(filterMutes(entries, '')).toBe(entries);
    expect(filterMutes(entries, '   ')).toBe(entries);
  });

  it('matches a substring of the path case-insensitively', () => {
    const out = filterMutes(entries, 'LOGS');
    expect(out.map((e) => e.path)).toEqual(['/logs/noisy.md']);
  });

  it('matches a substring of the reason', () => {
    const out = filterMutes(entries, 'outdated');
    expect(out.map((e) => e.path)).toEqual(['/notes/scratch.md']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterMutes(entries, 'zzz-no-hit')).toEqual([]);
  });

  it('does not throw when the entry has no reason', () => {
    const out = filterMutes(entries, 'api');
    expect(out.map((e) => e.path)).toEqual(['/docs/api.md']);
  });
});
