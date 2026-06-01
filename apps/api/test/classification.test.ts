import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getPolicy,
  setPolicy,
  setLabel,
  getLabel,
  listLabels,
  evaluateShare,
  invalidateCache,
  invalidateLabels,
  ClassificationValidationError,
  LABELS,
} from '../src/services/classification.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-classification-'));
  invalidateCache();
  invalidateLabels();
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('classification policy service', () => {
  it('returns the default policy when no file exists', async () => {
    const p = await getPolicy(dir);
    expect(p.allowPublicShareUpTo).toBe('restricted');
    expect(p.defaultLabel).toBe('internal');
    expect(p.updatedBy).toBeNull();
  });

  it('persists partial updates without resetting other fields', async () => {
    await setPolicy(dir, 'alice', { allowPublicShareUpTo: 'public' });
    const first = await getPolicy(dir);
    expect(first.allowPublicShareUpTo).toBe('public');
    expect(first.defaultLabel).toBe('internal');
    await setPolicy(dir, 'alice', { defaultLabel: 'confidential' });
    const second = await getPolicy(dir);
    expect(second.allowPublicShareUpTo).toBe('public');
    expect(second.defaultLabel).toBe('confidential');
    expect(second.updatedBy).toBe('alice');
  });

  it('rejects unknown labels in the policy', async () => {
    await expect(
      // @ts-expect-error intentional bad input
      setPolicy(dir, 'alice', { allowPublicShareUpTo: 'top-secret' }),
    ).rejects.toBeInstanceOf(ClassificationValidationError);
  });

  it('round-trips per-path labels', async () => {
    await setLabel(dir, 'alice', 'docs/handbook.md', 'public');
    await setLabel(dir, 'alice', 'docs/finances.md', 'restricted');
    expect(await getLabel(dir, 'docs/handbook.md')).toBe('public');
    expect(await getLabel(dir, 'docs/missing.md')).toBeNull();
    const all = await listLabels(dir);
    expect(all).toEqual([
      { path: 'docs/finances.md', label: 'restricted' },
      { path: 'docs/handbook.md', label: 'public' },
    ]);
  });

  it('clears labels when null is set', async () => {
    await setLabel(dir, 'alice', 'docs/x.md', 'confidential');
    expect(await getLabel(dir, 'docs/x.md')).toBe('confidential');
    await setLabel(dir, 'alice', 'docs/x.md', null);
    expect(await getLabel(dir, 'docs/x.md')).toBeNull();
  });
});

describe('classification evaluateShare', () => {
  const base = {
    workspaceId: 'default',
    allowPublicShareUpTo: 'public' as const,
    defaultLabel: 'internal' as const,
    updatedAt: 0,
    updatedBy: null,
  };

  it('passes through when the cap is restricted (effectively off)', async () => {
    const policy = { ...base, allowPublicShareUpTo: 'restricted' as const };
    const d = await evaluateShare(dir, policy, ['anything.md']);
    expect(d.ok).toBe(true);
  });

  it('blocks an unlabelled source when the default exceeds the cap', async () => {
    // Cap is "public", default is "internal" -> any unlabelled path is
    // implicitly internal and therefore blocked.
    const d = await evaluateShare(dir, base, ['docs/notes.md']);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('label-exceeds-cap');
    expect(d.blockedPath).toBe('docs/notes.md');
    expect(d.blockedLabel).toBe('internal');
  });

  it('permits a source explicitly labelled at or below the cap', async () => {
    await setLabel(dir, 'alice', 'docs/handbook.md', 'public');
    invalidateLabels();
    const d = await evaluateShare(dir, base, ['docs/handbook.md']);
    expect(d.ok).toBe(true);
  });

  it('blocks the first violation when multiple sources are cited', async () => {
    await setLabel(dir, 'alice', 'a.md', 'public');
    await setLabel(dir, 'alice', 'b.md', 'confidential');
    invalidateLabels();
    const d = await evaluateShare(dir, base, ['a.md', 'b.md']);
    expect(d.ok).toBe(false);
    expect(d.blockedPath).toBe('b.md');
    expect(d.blockedLabel).toBe('confidential');
  });

  it('exposes the four-level scale in canonical rank order', () => {
    expect(LABELS).toEqual(['public', 'internal', 'confidential', 'restricted']);
  });
});
