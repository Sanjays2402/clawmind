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
  SubProcessorValidationError,
} from '../src/services/sub-processors.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-subp-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('sub-processor registry validation', () => {
  it('rejects missing required fields', () => {
    expect(() => validateCreate({ name: '', purpose: 'p', region: 'us' } as any)).toThrow(
      SubProcessorValidationError,
    );
    expect(() => validateCreate({ name: 'n', purpose: '', region: 'us' } as any)).toThrow(
      SubProcessorValidationError,
    );
    expect(() => validateCreate({ name: 'n', purpose: 'p', region: '' } as any)).toThrow(
      SubProcessorValidationError,
    );
  });

  it('rejects malformed website URL', () => {
    expect(() =>
      validateCreate({ name: 'n', purpose: 'p', region: 'us', website: 'not a url' } as any),
    ).toThrow(SubProcessorValidationError);
  });

  it('accepts a valid disclosure', () => {
    const v = validateCreate({
      name: 'AcmeDB',
      purpose: 'Primary database',
      region: 'us-east-1',
      website: 'https://acme.example/dpa',
      notes: 'pinned to us-east-1',
    });
    expect(v.name).toBe('AcmeDB');
    expect(v.website).toBe('https://acme.example/dpa');
  });
});

describe('sub-processor registry CRUD', () => {
  it('starts empty', async () => {
    const reg = await getRegistry(dir);
    expect(reg.entries).toEqual([]);
    expect(reg.intro).toBe('');
    expect(reg.contactEmail).toBeNull();
  });

  it('adds, persists, and exposes a public projection without notes', async () => {
    const { change, registry } = await addEntry(dir, 'user_owner', {
      name: 'AcmeDB',
      purpose: 'Primary database',
      region: 'us-east-1',
      website: 'https://acme.example/dpa',
      notes: 'internal-only note',
    });
    expect(change.kind).toBe('added');
    expect(registry.entries).toHaveLength(1);

    const reloaded = await getRegistry(dir);
    expect(reloaded.entries).toHaveLength(1);
    expect(reloaded.entries[0]!.notes).toBe('internal-only note');
    expect(reloaded.updatedBy).toBe('user_owner');

    const pub = publicView(reloaded);
    expect(pub.entries).toHaveLength(1);
    expect((pub.entries[0] as Record<string, unknown>).notes).toBeUndefined();
  });

  it('rejects a duplicate active name, allows it when the prior is retired', async () => {
    await addEntry(dir, 'u', { name: 'AcmeDB', purpose: 'p', region: 'us' });
    await expect(
      addEntry(dir, 'u', { name: 'acmedb', purpose: 'p', region: 'us' }),
    ).rejects.toThrow(SubProcessorValidationError);

    const reg = await getRegistry(dir);
    await retireEntry(dir, 'u', reg.entries[0]!.id);
    // After retirement, re-adding the same name is allowed (re-onboard).
    const { change } = await addEntry(dir, 'u', {
      name: 'AcmeDB',
      purpose: 'p',
      region: 'us',
    });
    expect(change.kind).toBe('added');
    const after = await getRegistry(dir);
    expect(after.entries).toHaveLength(2);
    expect(after.entries.filter((e) => e.status === 'active')).toHaveLength(1);
  });

  it('classifies status flips as retired / restored', async () => {
    const { change: created } = await addEntry(dir, 'u', {
      name: 'X',
      purpose: 'p',
      region: 'eu',
    });
    const id = created.entry.id;

    const { change: retired } = await retireEntry(dir, 'u', id);
    expect(retired.kind).toBe('retired');
    expect(retired.previous?.status).toBe('active');

    const { change: restored } = await updateEntry(dir, 'u', id, { status: 'active' });
    expect(restored.kind).toBe('restored');
  });

  it('returns 404-shaped error for unknown id', async () => {
    await expect(
      updateEntry(dir, 'u', 'sp_does_not_exist', { name: 'x' }),
    ).rejects.toThrow(/no sub-processor/);
  });

  it('settings round-trip and reject malformed email', async () => {
    const ok = await updateSettings(dir, 'u', {
      intro: 'See below for our current sub-processors.',
      contactEmail: 'dpo@example.com',
    });
    expect(ok.contactEmail).toBe('dpo@example.com');
    await expect(updateSettings(dir, 'u', { contactEmail: 'nope' })).rejects.toThrow(
      SubProcessorValidationError,
    );
  });
});

describe('filterEntries', () => {
  const entries = [
    { name: 'Acme Hosting Inc.', purpose: 'Object storage', region: 'US' },
    { name: 'Bravo Email', purpose: 'Transactional email delivery', region: 'EU' },
    { name: 'Charlie Analytics', purpose: 'Product analytics', region: 'EU' },
  ];

  it('returns the input when q is empty or whitespace', () => {
    expect(filterEntries(entries, undefined)).toBe(entries);
    expect(filterEntries(entries, '')).toBe(entries);
    expect(filterEntries(entries, '   ')).toBe(entries);
  });

  it('matches a substring of the legal name case-insensitively', () => {
    const out = filterEntries(entries, 'acme');
    expect(out.map((e) => e.name)).toEqual(['Acme Hosting Inc.']);
  });

  it('matches a substring of the purpose', () => {
    const out = filterEntries(entries, 'analytics');
    expect(out.map((e) => e.name)).toEqual(['Charlie Analytics']);
  });

  it('matches a substring of the region', () => {
    const out = filterEntries(entries, 'eu');
    expect(out.map((e) => e.name)).toEqual(['Bravo Email', 'Charlie Analytics']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterEntries(entries, 'zzz-no-hit')).toEqual([]);
  });
});
