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
  validateCreate,
  RopaValidationError,
} from '../src/services/ropa.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-ropa-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

const sample = {
  name: 'Customer support',
  purpose: 'Answer questions from end-users about ClawMind',
  legalBasis: 'contract' as const,
  dataCategories: 'name, email, message body',
  dataSubjects: 'customers, end-users',
  storageRegion: 'us-east-1',
  retention: '24 months after ticket closure',
  recipients: 'Zendesk',
  transferMechanism: 'SCCs 2021/914 module 2',
  notes: 'pinned to us-east-1',
};

describe('ropa validation', () => {
  it('rejects missing required fields', () => {
    expect(() => validateCreate({ ...sample, name: '' } as any)).toThrow(RopaValidationError);
    expect(() => validateCreate({ ...sample, purpose: '' } as any)).toThrow(RopaValidationError);
    expect(() => validateCreate({ ...sample, dataCategories: '' } as any)).toThrow(
      RopaValidationError,
    );
    expect(() => validateCreate({ ...sample, retention: '' } as any)).toThrow(
      RopaValidationError,
    );
  });

  it('rejects an unknown legal basis', () => {
    expect(() => validateCreate({ ...sample, legalBasis: 'guesswork' as any })).toThrow(
      RopaValidationError,
    );
  });

  it('accepts a complete disclosure', () => {
    const v = validateCreate(sample);
    expect(v.name).toBe('Customer support');
    expect(v.legalBasis).toBe('contract');
    expect(v.recipients).toBe('Zendesk');
    expect(v.transferMechanism).toBe('SCCs 2021/914 module 2');
  });
});

describe('ropa registry CRUD', () => {
  it('starts empty', async () => {
    const reg = await getRegistry(dir);
    expect(reg.entries).toEqual([]);
    expect(reg.intro).toBe('');
    expect(reg.controllerContact).toBeNull();
    expect(reg.dpoName).toBeNull();
  });

  it('add → update → retire → restore round-trip with broadcast kinds', async () => {
    const { change: addChange } = await addEntry(dir, 'user_a', sample);
    expect(addChange.kind).toBe('added');
    const id = addChange.entry.id;

    const { change: upd } = await updateEntry(dir, 'user_a', id, {
      purpose: 'Answer support tickets',
    });
    expect(upd.kind).toBe('updated');
    expect(upd.entry.purpose).toBe('Answer support tickets');

    const { change: ret } = await retireEntry(dir, 'user_a', id);
    expect(ret.kind).toBe('retired');
    expect(ret.entry.status).toBe('retired');

    const { change: res } = await updateEntry(dir, 'user_a', id, { status: 'active' });
    expect(res.kind).toBe('restored');
    expect(res.entry.status).toBe('active');
  });

  it('rejects duplicate active names case-insensitively', async () => {
    await addEntry(dir, 'u', sample);
    await expect(addEntry(dir, 'u', { ...sample, name: 'CUSTOMER SUPPORT' })).rejects.toThrow(
      RopaValidationError,
    );
  });

  it('allows re-adding a name after retiring it', async () => {
    const { change } = await addEntry(dir, 'u', sample);
    await retireEntry(dir, 'u', change.entry.id);
    const second = await addEntry(dir, 'u', sample);
    expect(second.change.entry.id).not.toBe(change.entry.id);
  });

  it('updateSettings validates the controller email', async () => {
    await expect(
      updateSettings(dir, 'u', { controllerContact: 'not-an-email' as any }),
    ).rejects.toThrow(RopaValidationError);
    const ok = await updateSettings(dir, 'u', {
      intro: 'We process the following.',
      controllerContact: 'dpo@example.com',
      dpoName: 'Jane Doe',
    });
    expect(ok.intro).toBe('We process the following.');
    expect(ok.controllerContact).toBe('dpo@example.com');
    expect(ok.dpoName).toBe('Jane Doe');
  });

  it('publicView strips operator-only notes', async () => {
    await updateSettings(dir, 'u', { controllerContact: 'dpo@example.com' });
    await addEntry(dir, 'u', sample);
    const reg = await getRegistry(dir);
    const pub = publicView(reg);
    expect(pub.controllerContact).toBe('dpo@example.com');
    expect(pub.entries).toHaveLength(1);
    // notes must not leak.
    expect((pub.entries[0] as any).notes).toBeUndefined();
    // updatedBy must not leak.
    expect((pub as any).updatedBy).toBeUndefined();
  });

  it('updateEntry on an unknown id throws a validation error', async () => {
    await expect(updateEntry(dir, 'u', 'missing', { purpose: 'x' })).rejects.toThrow(
      RopaValidationError,
    );
  });
});
