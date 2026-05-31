import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createShare,
  readShare,
  readShareRaw,
  bumpViews,
  listSharesByUser,
  deleteShare,
  isExpired,
  clampTtlMs,
  DEFAULT_SHARE_TTL_MS,
  MAX_SHARE_TTL_MS,
} from '../src/services/share.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-share-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('share service', () => {
  it('creates a share bound to the owner', async () => {
    const { id } = await createShare(dir, {
      userId: 'alice',
      query: 'q',
      answer: 'a',
      sources: [],
    });
    const got = await readShare(dir, id);
    expect(got).not.toBeNull();
    expect(got!.userId).toBe('alice');
    expect(got!.views).toBe(0);
  });

  it('returns null for missing or bogus ids', async () => {
    expect(await readShare(dir, 'nope')).toBeNull();
    // Path traversal must not escape the shares dir.
    expect(await readShare(dir, '../etc/passwd')).toBeNull();
  });

  it('lists only my shares, not other users', async () => {
    await createShare(dir, { userId: 'alice', query: 'a1', answer: 'x', sources: [] });
    await createShare(dir, { userId: 'alice', query: 'a2', answer: 'x', sources: [] });
    await createShare(dir, { userId: 'bob',   query: 'b1', answer: 'x', sources: [] });
    const mine = await listSharesByUser(dir, 'alice');
    expect(mine.map((s) => s.query).sort()).toEqual(['a1', 'a2']);
  });

  it('bumps view counter and persists it', async () => {
    const { id } = await createShare(dir, { userId: 'u', query: 'q', answer: 'a', sources: [] });
    expect(await bumpViews(dir, id)).toBe(1);
    expect(await bumpViews(dir, id)).toBe(2);
    expect((await readShare(dir, id))!.views).toBe(2);
  });

  it('owner can delete; non-owner cannot', async () => {
    const { id } = await createShare(dir, { userId: 'alice', query: 'q', answer: 'a', sources: [] });
    expect(await deleteShare(dir, id, 'mallory')).toBe(false);
    expect(await readShare(dir, id)).not.toBeNull();
    expect(await deleteShare(dir, id, 'alice')).toBe(true);
    expect(await readShare(dir, id)).toBeNull();
  });

  it('legacy shares without userId are not listed under any account', async () => {
    // Simulate a pre-ownership share by writing the file directly.
    const { id } = await createShare(dir, { userId: 'temp', query: 'old', answer: 'a', sources: [] });
    const fs = await import('node:fs/promises');
    const path = join(dir, 'shares', `${id}.json`);
    const raw = JSON.parse(await fs.readFile(path, 'utf8'));
    delete raw.userId;
    await fs.writeFile(path, JSON.stringify(raw));
    const mine = await listSharesByUser(dir, 'temp');
    expect(mine.length).toBe(0);
    // But still readable by id (link survival).
    expect(await readShare(dir, id)).not.toBeNull();
  });

  it('clampTtlMs enforces default + ceiling', () => {
    expect(clampTtlMs(undefined)).toBe(DEFAULT_SHARE_TTL_MS);
    expect(clampTtlMs(null)).toBeNull();
    expect(clampTtlMs(0)).toBe(DEFAULT_SHARE_TTL_MS);
    expect(clampTtlMs(-5)).toBe(DEFAULT_SHARE_TTL_MS);
    expect(clampTtlMs(1000)).toBe(1000);
    expect(clampTtlMs(MAX_SHARE_TTL_MS * 10)).toBe(MAX_SHARE_TTL_MS);
  });

  it('sets expiresAt by default and exposes it on summaries', async () => {
    const before = Date.now();
    const { id, expiresAt } = await createShare(dir, {
      userId: 'alice', query: 'q', answer: 'a', sources: [],
    });
    expect(expiresAt).not.toBeNull();
    expect(expiresAt!).toBeGreaterThan(before);
    const summaries = await listSharesByUser(dir, 'alice');
    const s = summaries.find((x) => x.id === id)!;
    expect(s.expiresAt).toBe(expiresAt);
    expect(s.expired).toBe(false);
  });

  it('honours ttlMs=null as "never expires"', async () => {
    const { expiresAt } = await createShare(dir, {
      userId: 'alice', query: 'q', answer: 'a', sources: [], ttlMs: null,
    });
    expect(expiresAt).toBeNull();
  });

  it('expired shares are hidden from readShare and bumpViews; readShareRaw still returns them', async () => {
    const { id } = await createShare(dir, {
      userId: 'alice', query: 'q', answer: 'a', sources: [], ttlMs: 1,
    });
    // Wait past the 1ms TTL.
    await new Promise((r) => setTimeout(r, 10));
    expect(await readShare(dir, id)).toBeNull();
    // Public viewer view-bump must not resurrect counts on expired links.
    expect(await bumpViews(dir, id)).toBe(0);
    // Raw still readable so the route layer can return 410 vs 404.
    const raw = await readShareRaw(dir, id);
    expect(raw).not.toBeNull();
    expect(isExpired(raw!)).toBe(true);
    // List marks it expired but still shows it so the owner can clean up.
    const mine = await listSharesByUser(dir, 'alice');
    const row = mine.find((s) => s.id === id)!;
    expect(row.expired).toBe(true);
  });

  it('owner can revoke expired shares (cleanup)', async () => {
    const { id } = await createShare(dir, {
      userId: 'alice', query: 'q', answer: 'a', sources: [], ttlMs: 1,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(await deleteShare(dir, id, 'alice')).toBe(true);
    expect(await readShareRaw(dir, id)).toBeNull();
  });
});
