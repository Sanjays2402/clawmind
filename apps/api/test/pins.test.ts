import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addPin, removePin, loadPins, pinBoostFor, PIN_BOOST,
} from '../src/services/pins.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-pins-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('pins service', () => {
  it('returns an empty map on first load', async () => {
    expect(await loadPins(dir)).toEqual({});
  });

  it('adds a pin and persists it', async () => {
    const entry = await addPin(dir, 'u1', '/notes/spec.md', 'core spec');
    expect(entry.path).toBe('/notes/spec.md');
    expect(entry.note).toBe('core spec');
    expect(entry.pinnedBy).toBe('u1');
    const map = await loadPins(dir);
    expect(map['/notes/spec.md']).toEqual(entry);
  });

  it('addPin overwrites an existing pin', async () => {
    const first = await addPin(dir, 'u1', '/a.md', 'old');
    // ensure monotonic timestamp on systems with coarse mtime resolution
    await new Promise((r) => setTimeout(r, 2));
    const second = await addPin(dir, 'u2', '/a.md', 'new');
    expect(second.pinnedAt).toBeGreaterThanOrEqual(first.pinnedAt);
    expect(second.pinnedBy).toBe('u2');
    expect(second.note).toBe('new');
  });

  it('empty/whitespace note is normalized to undefined', async () => {
    const entry = await addPin(dir, 'u1', '/a.md', '   ');
    expect(entry.note).toBeUndefined();
  });

  it('removePin returns true on existing, false on missing', async () => {
    await addPin(dir, 'u1', '/a.md');
    expect(await removePin(dir, '/a.md')).toBe(true);
    expect(await removePin(dir, '/a.md')).toBe(false);
    expect(await loadPins(dir)).toEqual({});
  });
});

describe('pinBoostFor', () => {
  it('returns 1 for unpinned paths', () => {
    expect(pinBoostFor({}, '/x.md')).toBe(1);
  });

  it('returns PIN_BOOST for pinned paths', () => {
    const map = {
      '/x.md': { path: '/x.md', pinnedAt: 0, pinnedBy: 'u1' },
    };
    expect(pinBoostFor(map, '/x.md')).toBe(PIN_BOOST);
    expect(PIN_BOOST).toBeGreaterThan(1);
  });
});
