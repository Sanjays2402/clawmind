import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getRegistry,
  addEntry,
  updateEntry,
  retireEntry,
  updateSettings,
  publicView,
  filterEntries,
  validateCreate,
  RecoveryContactValidationError,
} from '../src/services/recovery-contacts.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-rc-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('recovery contacts validation', () => {
  it('rejects missing required fields', () => {
    expect(() =>
      validateCreate({ name: '', role: 'DPO', email: 'a@b.co' } as any),
    ).toThrow(RecoveryContactValidationError);
    expect(() =>
      validateCreate({ name: 'A', role: '', email: 'a@b.co' } as any),
    ).toThrow(RecoveryContactValidationError);
    expect(() =>
      validateCreate({ name: 'A', role: 'DPO', email: '' } as any),
    ).toThrow(RecoveryContactValidationError);
  });

  it('rejects malformed email', () => {
    expect(() =>
      validateCreate({ name: 'A', role: 'DPO', email: 'not-an-email' } as any),
    ).toThrow(RecoveryContactValidationError);
  });

  it('rejects priority outside 1..999', () => {
    expect(() =>
      validateCreate({ name: 'A', role: 'DPO', email: 'a@b.co', priority: 0 } as any),
    ).toThrow(RecoveryContactValidationError);
    expect(() =>
      validateCreate({ name: 'A', role: 'DPO', email: 'a@b.co', priority: 1000 } as any),
    ).toThrow(RecoveryContactValidationError);
  });

  it('accepts a valid contact and defaults publicListed=false', () => {
    const v = validateCreate({ name: 'Alice', role: 'DPO', email: 'alice@example.com' });
    expect(v.publicListed).toBe(false);
    expect(v.priority).toBe(100);
  });
});

describe('recovery contacts CRUD', () => {
  it('starts empty with safe defaults', async () => {
    const reg = await getRegistry(dir);
    expect(reg.entries).toEqual([]);
    expect(reg.intro).toBe('');
    expect(reg.fallbackEmail).toBeNull();
  });

  it('adds and persists', async () => {
    const { change, registry } = await addEntry(dir, 'user_owner', {
      name: 'Alice',
      role: 'DPO',
      email: 'alice@example.com',
      publicListed: true,
      priority: 1,
      notes: 'after-hours via signal',
    });
    expect(change.kind).toBe('added');
    expect(registry.entries).toHaveLength(1);
    const reloaded = await getRegistry(dir);
    expect(reloaded.entries[0]!.notes).toBe('after-hours via signal');
    expect(reloaded.updatedBy).toBe('user_owner');
  });

  it('rejects duplicate active email', async () => {
    await addEntry(dir, 'u', { name: 'A', role: 'DPO', email: 'a@b.co' });
    await expect(
      addEntry(dir, 'u', { name: 'B', role: 'SRE', email: 'a@b.co' }),
    ).rejects.toBeInstanceOf(RecoveryContactValidationError);
  });

  it('allows reusing email after retirement', async () => {
    const { change } = await addEntry(dir, 'u', {
      name: 'A',
      role: 'DPO',
      email: 'a@b.co',
    });
    await retireEntry(dir, 'u', change.entry.id);
    await expect(
      addEntry(dir, 'u', { name: 'B', role: 'DPO', email: 'a@b.co' }),
    ).resolves.toBeTruthy();
  });

  it('update reports retired/restored transitions', async () => {
    const { change } = await addEntry(dir, 'u', {
      name: 'A',
      role: 'DPO',
      email: 'a@b.co',
    });
    const retired = await updateEntry(dir, 'u', change.entry.id, { status: 'retired' });
    expect(retired.change.kind).toBe('retired');
    const restored = await updateEntry(dir, 'u', change.entry.id, { status: 'active' });
    expect(restored.change.kind).toBe('restored');
  });

  it('updateSettings stores intro and fallbackEmail', async () => {
    const next = await updateSettings(dir, 'u', {
      intro: 'Escalation list for BCP.',
      fallbackEmail: 'security@example.com',
    });
    expect(next.intro).toBe('Escalation list for BCP.');
    expect(next.fallbackEmail).toBe('security@example.com');
  });

  it('rejects invalid fallback email', async () => {
    await expect(
      updateSettings(dir, 'u', { fallbackEmail: 'not-an-email' }),
    ).rejects.toBeInstanceOf(RecoveryContactValidationError);
  });

  it('rejects update with no matching id', async () => {
    await expect(updateEntry(dir, 'u', 'rc_missing', {})).rejects.toBeInstanceOf(
      RecoveryContactValidationError,
    );
  });
});

describe('public view', () => {
  it('hides entries not marked publicListed', async () => {
    await addEntry(dir, 'u', { name: 'A', role: 'DPO', email: 'a@b.co', publicListed: false });
    await addEntry(dir, 'u', { name: 'B', role: 'SRE', email: 'b@b.co', publicListed: true, priority: 5 });
    const reg = await getRegistry(dir);
    const pub = publicView(reg);
    expect(pub.entries).toHaveLength(1);
    expect(pub.entries[0]!.name).toBe('B');
    // Sensitive operator fields must not surface.
    expect((pub.entries[0] as Record<string, unknown>).notes).toBeUndefined();
    expect((pub.entries[0] as Record<string, unknown>).id).toBeUndefined();
  });

  it('hides retired entries even if publicListed=true', async () => {
    const { change } = await addEntry(dir, 'u', {
      name: 'A',
      role: 'DPO',
      email: 'a@b.co',
      publicListed: true,
    });
    await retireEntry(dir, 'u', change.entry.id);
    const reg = await getRegistry(dir);
    expect(publicView(reg).entries).toHaveLength(0);
  });

  it('sorts public entries by priority ascending then name', async () => {
    await addEntry(dir, 'u', {
      name: 'Charlie',
      role: 'SRE',
      email: 'c@b.co',
      publicListed: true,
      priority: 5,
    });
    await addEntry(dir, 'u', {
      name: 'Alice',
      role: 'DPO',
      email: 'a@b.co',
      publicListed: true,
      priority: 1,
    });
    await addEntry(dir, 'u', {
      name: 'Bob',
      role: 'SRE',
      email: 'b@b.co',
      publicListed: true,
      priority: 5,
    });
    const reg = await getRegistry(dir);
    const names = publicView(reg).entries.map((e) => e.name);
    expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
  });
});

describe('filterEntries (recovery contacts)', () => {
  const entries = [
    { name: 'Alice Chen', role: 'DPO', email: 'alice@example.com' },
    { name: 'Bob Singh', role: 'SRE on-call', email: 'bob@example.com' },
    { name: 'Charlie Diaz', role: 'Security lead', email: 'charlie@vendor.io' },
  ];

  it('returns the input when q is empty or whitespace', () => {
    expect(filterEntries(entries, undefined)).toBe(entries);
    expect(filterEntries(entries, '')).toBe(entries);
    expect(filterEntries(entries, '   ')).toBe(entries);
  });

  it('matches a substring of the name case-insensitively', () => {
    expect(filterEntries(entries, 'alice').map((e) => e.name)).toEqual(['Alice Chen']);
  });

  it('matches a substring of the role', () => {
    expect(filterEntries(entries, 'sre').map((e) => e.name)).toEqual(['Bob Singh']);
  });

  it('matches a substring of the email domain', () => {
    expect(filterEntries(entries, 'vendor.io').map((e) => e.name)).toEqual(['Charlie Diaz']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterEntries(entries, 'zzz-no-hit')).toEqual([]);
  });
});
