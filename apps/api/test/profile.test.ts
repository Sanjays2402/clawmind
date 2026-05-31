import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getProfile, updateProfile, validatePatch, PROFILE_LIMITS } from '../src/services/profile.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-profile-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('profile service', () => {
  it('synthesises a default profile on first read without writing the file', async () => {
    const p = await getProfile(dir, 'alice');
    expect(p.userId).toBe('alice');
    expect(p.displayName).toBe('alice');
    expect(p.timezone).toBe('UTC');
    expect(p.defaultModel).toBeNull();
    expect(() => readFileSync(join(dir, 'profiles.json'))).toThrow();
  });

  it('persists an update and round-trips it on read', async () => {
    const saved = await updateProfile(dir, 'alice', {
      displayName: '  Alice  ',
      timezone: 'America/Los_Angeles',
      defaultModel: 'gpt-4o-mini',
    });
    expect(saved.displayName).toBe('Alice');
    expect(saved.timezone).toBe('America/Los_Angeles');
    expect(saved.defaultModel).toBe('gpt-4o-mini');
    expect(saved.createdAt).toBeGreaterThan(0);
    expect(saved.updatedAt).toBeGreaterThanOrEqual(saved.createdAt);

    const fresh = await getProfile(dir, 'alice');
    expect(fresh).toEqual(saved);
  });

  it('isolates profiles per user', async () => {
    await updateProfile(dir, 'alice', { displayName: 'Alice A' });
    await updateProfile(dir, 'bob', { displayName: 'Bob B' });
    const a = await getProfile(dir, 'alice');
    const b = await getProfile(dir, 'bob');
    expect(a.displayName).toBe('Alice A');
    expect(b.displayName).toBe('Bob B');
  });

  it('normalises an empty defaultModel string to null', async () => {
    const p = await updateProfile(dir, 'alice', { defaultModel: '   ' });
    expect(p.defaultModel).toBeNull();
  });

  it('rejects empty displayName and oversized fields and bad timezone', () => {
    expect(validatePatch({ displayName: '   ' }).ok).toBe(false);
    expect(validatePatch({ displayName: 'x'.repeat(PROFILE_LIMITS.MAX_NAME + 1) }).ok).toBe(false);
    expect(validatePatch({ timezone: '' }).ok).toBe(false);
    expect(validatePatch({ timezone: 'not a zone!' }).ok).toBe(false);
    expect(validatePatch({ timezone: 'America/Los_Angeles' }).ok).toBe(true);
    expect(validatePatch({ defaultModel: 'x'.repeat(PROFILE_LIMITS.MAX_MODEL + 1) }).ok).toBe(false);
    expect(validatePatch({ defaultModel: null }).ok).toBe(true);
  });

  it('updateProfile throws on invalid patch', async () => {
    await expect(updateProfile(dir, 'alice', { timezone: 'bogus!' })).rejects.toThrow(/invalid profile patch/);
  });
});
