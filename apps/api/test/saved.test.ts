import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addSaved, listSaved, updateSaved, removeSaved, getSaved } from '../src/services/saved.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-saved-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('saved searches service', () => {
  it('adds and lists per user', async () => {
    const a = await addSaved(dir, 'u1', { title: 'Ingest activity', query: 'recent ingest' });
    await addSaved(dir, 'u2', { title: 'Other', query: 'q' });
    const items = await listSaved(dir, 'u1');
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(a.id);
    expect(items[0].tags).toEqual([]);
    expect(items[0].updatedAt).toBe(a.createdAt);
  });

  it('normalizes tags on create', async () => {
    const a = await addSaved(dir, 'u1', {
      title: 't', query: 'q',
      tags: ['Work', 'work', 'two words', 'BAD/slash', 'Ops'],
    });
    expect(a.tags).toEqual(['ops', 'two-words', 'work']);
  });

  it('renames a saved search via updateSaved', async () => {
    const a = await addSaved(dir, 'u1', { title: 'old', query: 'q' });
    await new Promise((r) => setTimeout(r, 2));
    const next = await updateSaved(dir, 'u1', a.id, { title: 'new title' });
    expect(next?.title).toBe('new title');
    expect(next?.query).toBe('q');
    expect(next?.updatedAt).toBeGreaterThan(a.createdAt);
  });

  it('updates tags and query independently', async () => {
    const a = await addSaved(dir, 'u1', { title: 't', query: 'q', tags: ['x'] });
    const r1 = await updateSaved(dir, 'u1', a.id, { tags: ['y', 'z', 'y'] });
    expect(r1?.tags).toEqual(['y', 'z']);
    expect(r1?.title).toBe('t');
    const r2 = await updateSaved(dir, 'u1', a.id, { query: 'new q' });
    expect(r2?.query).toBe('new q');
    expect(r2?.tags).toEqual(['y', 'z']);
  });

  it('returns null for unknown id or wrong user', async () => {
    const a = await addSaved(dir, 'u1', { title: 't', query: 'q' });
    expect(await updateSaved(dir, 'u1', 'nope', { title: 'x' })).toBeNull();
    expect(await updateSaved(dir, 'u2', a.id, { title: 'x' })).toBeNull();
  });

  it('rejects empty title or query', async () => {
    const a = await addSaved(dir, 'u1', { title: 't', query: 'q' });
    await expect(updateSaved(dir, 'u1', a.id, { title: '   ' })).rejects.toThrow(/non-empty/);
  });

  it('removeSaved is user-scoped', async () => {
    const a = await addSaved(dir, 'u1', { title: 't', query: 'q' });
    await removeSaved(dir, 'u2', a.id);
    expect(await listSaved(dir, 'u1')).toHaveLength(1);
    await removeSaved(dir, 'u1', a.id);
    expect(await listSaved(dir, 'u1')).toHaveLength(0);
  });

  it('getSaved returns the entry only for its owner', async () => {
    const a = await addSaved(dir, 'u1', { title: 't', query: 'q', tags: ['x'] });
    const found = await getSaved(dir, 'u1', a.id);
    expect(found?.id).toBe(a.id);
    expect(found?.tags).toEqual(['x']);
    expect(await getSaved(dir, 'u2', a.id)).toBeNull();
    expect(await getSaved(dir, 'u1', 'nope')).toBeNull();
  });
});
