import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCollection,
  listCollections,
  updateCollection,
  deleteCollection,
  assignSavedToCollection,
  removeSavedFromCollection,
  setMembers,
  listMembers,
  membershipForUser,
  getCollection,
} from '../src/services/collections.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-collections-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('collections service', () => {
  it('creates and lists per user', async () => {
    const a = await createCollection(dir, 'u1', { name: 'Onboarding' });
    await createCollection(dir, 'u2', { name: 'Other' });
    const items = await listCollections(dir, 'u1');
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(a.id);
    expect(items[0].itemCount).toBe(0);
    expect(items[0].color).toBe('slate');
  });

  it('normalizes name whitespace and rejects empty', async () => {
    const a = await createCollection(dir, 'u1', { name: '  Spaced   Out  ' });
    expect(a.name).toBe('Spaced Out');
    await expect(createCollection(dir, 'u1', { name: '   ' })).rejects.toThrow(/non-empty/);
  });

  it('rejects duplicate names per user, case-insensitive', async () => {
    await createCollection(dir, 'u1', { name: 'Playbooks' });
    await expect(createCollection(dir, 'u1', { name: 'playbooks' })).rejects.toThrow(/already exists/);
    // Same name in another user namespace is fine.
    await expect(createCollection(dir, 'u2', { name: 'Playbooks' })).resolves.toBeTruthy();
  });

  it('normalizes color to the palette', async () => {
    const a = await createCollection(dir, 'u1', { name: 'A', color: 'fuchsia' as never });
    expect(a.color).toBe('slate');
    const b = await createCollection(dir, 'u1', { name: 'B', color: 'violet' });
    expect(b.color).toBe('violet');
  });

  it('updates fields and bumps updatedAt', async () => {
    const a = await createCollection(dir, 'u1', { name: 'A' });
    await new Promise((r) => setTimeout(r, 2));
    const next = await updateCollection(dir, 'u1', a.id, { name: 'B', color: 'amber' });
    expect(next?.name).toBe('B');
    expect(next?.color).toBe('amber');
    expect(next!.updatedAt).toBeGreaterThan(a.updatedAt);
  });

  it('blocks update collision with another collection name', async () => {
    const a = await createCollection(dir, 'u1', { name: 'A' });
    await createCollection(dir, 'u1', { name: 'B' });
    await expect(updateCollection(dir, 'u1', a.id, { name: 'b' })).rejects.toThrow(/already exists/);
  });

  it('returns null for unknown id or wrong user on update/get', async () => {
    const a = await createCollection(dir, 'u1', { name: 'A' });
    expect(await updateCollection(dir, 'u1', 'nope', { name: 'x' })).toBeNull();
    expect(await updateCollection(dir, 'u2', a.id, { name: 'x' })).toBeNull();
    expect(await getCollection(dir, 'u2', a.id)).toBeNull();
  });

  it('assigns and removes members, ignoring duplicates', async () => {
    const a = await createCollection(dir, 'u1', { name: 'A' });
    expect(await assignSavedToCollection(dir, 'u1', a.id, 's1')).toBe(true);
    expect(await assignSavedToCollection(dir, 'u1', a.id, 's1')).toBe(false);
    await assignSavedToCollection(dir, 'u1', a.id, 's2');
    expect((await listCollections(dir, 'u1'))[0].itemCount).toBe(2);
    expect(await removeSavedFromCollection(dir, 'u1', a.id, 's1')).toBe(true);
    expect(await removeSavedFromCollection(dir, 'u1', a.id, 's1')).toBe(false);
    expect(await listMembers(dir, 'u1', a.id)).toEqual(['s2']);
  });

  it('setMembers replaces the full set and de-dupes', async () => {
    const a = await createCollection(dir, 'u1', { name: 'A' });
    await setMembers(dir, 'u1', a.id, ['s1', 's2', 's2', 's3']);
    expect((await listMembers(dir, 'u1', a.id)).sort()).toEqual(['s1', 's2', 's3']);
    await setMembers(dir, 'u1', a.id, ['s9']);
    expect(await listMembers(dir, 'u1', a.id)).toEqual(['s9']);
  });

  it('deleting a collection wipes its membership rows but not other users', async () => {
    const a = await createCollection(dir, 'u1', { name: 'A' });
    const b = await createCollection(dir, 'u2', { name: 'A' });
    await assignSavedToCollection(dir, 'u1', a.id, 's1');
    await assignSavedToCollection(dir, 'u2', b.id, 's1');
    expect(await deleteCollection(dir, 'u1', a.id)).toBe(true);
    expect(await deleteCollection(dir, 'u1', a.id)).toBe(false);
    expect(await listCollections(dir, 'u1')).toHaveLength(0);
    expect(await listMembers(dir, 'u2', b.id)).toEqual(['s1']);
  });

  it('membershipForUser groups saved ids by collection', async () => {
    const a = await createCollection(dir, 'u1', { name: 'A' });
    const b = await createCollection(dir, 'u1', { name: 'B' });
    await assignSavedToCollection(dir, 'u1', a.id, 's1');
    await assignSavedToCollection(dir, 'u1', b.id, 's1');
    await assignSavedToCollection(dir, 'u1', a.id, 's2');
    const map = await membershipForUser(dir, 'u1');
    expect(new Set(map['s1'])).toEqual(new Set([a.id, b.id]));
    expect(map['s2']).toEqual([a.id]);
  });

  it('member ops on unknown collection throw', async () => {
    await expect(assignSavedToCollection(dir, 'u1', 'missing', 's1')).rejects.toThrow(/not found/);
    await expect(setMembers(dir, 'u1', 'missing', ['s1'])).rejects.toThrow(/not found/);
  });
});
