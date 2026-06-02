import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  create,
  list,
  unreadCount,
  markRead,
  markAllRead,
  remove,
  clear,
  loadAll,
  MAX_PER_USER,
} from '../src/services/notifications.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-notifications-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('notifications service', () => {
  it('returns empty list and zero unread on first load', async () => {
    expect(await list(dir, 'u1')).toEqual([]);
    expect(await unreadCount(dir, 'u1')).toBe(0);
  });

  it('creates a notification and lists newest first', async () => {
    const a = (await create(dir, { userId: 'u1', kind: 'system', title: 'first' }, 1))!;
    const b = (await create(dir, { userId: 'u1', kind: 'system', title: 'second' }, 2))!;
    const items = await list(dir, 'u1');
    expect(items.map((i) => i.id)).toEqual([b.id, a.id]);
    expect(await unreadCount(dir, 'u1')).toBe(2);
  });

  it('isolates inboxes per user', async () => {
    await create(dir, { userId: 'u1', kind: 'system', title: 'mine' });
    await create(dir, { userId: 'u2', kind: 'system', title: 'theirs' });
    expect((await list(dir, 'u1')).map((i) => i.title)).toEqual(['mine']);
    expect((await list(dir, 'u2')).map((i) => i.title)).toEqual(['theirs']);
  });

  it('dedupeKey bumps existing unread row instead of inserting', async () => {
    const first = (await create(
      dir,
      { userId: 'u1', kind: 'share.viewed', title: '1 view', dedupeKey: 'share:abc' },
      10,
    ))!;
    const second = (await create(
      dir,
      { userId: 'u1', kind: 'share.viewed', title: '2 views', dedupeKey: 'share:abc' },
      20,
    ))!;
    expect(second.id).toBe(first.id);
    const items = await list(dir, 'u1');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('2 views');
    expect(items[0].createdAt).toBe(20);
    expect(await unreadCount(dir, 'u1')).toBe(1);
  });

  it('dedupeKey does not fold once the row has been marked read', async () => {
    const first = (await create(
      dir,
      { userId: 'u1', kind: 'share.viewed', title: '1 view', dedupeKey: 'share:abc' },
    ))!;
    await markRead(dir, 'u1', [first.id]);
    const second = (await create(
      dir,
      { userId: 'u1', kind: 'share.viewed', title: 'another view', dedupeKey: 'share:abc' },
    ))!;
    expect(second.id).not.toBe(first.id);
    expect((await list(dir, 'u1'))).toHaveLength(2);
  });

  it('unreadOnly filter and limit on list()', async () => {
    const a = (await create(dir, { userId: 'u1', kind: 'system', title: 'a' }, 1))!;
    await create(dir, { userId: 'u1', kind: 'system', title: 'b' }, 2);
    await create(dir, { userId: 'u1', kind: 'system', title: 'c' }, 3);
    await markRead(dir, 'u1', [a.id]);
    const unread = await list(dir, 'u1', { unreadOnly: true });
    expect(unread.map((i) => i.title)).toEqual(['c', 'b']);
    const limited = await list(dir, 'u1', { limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0].title).toBe('c');
  });

  it('markRead is idempotent and only counts newly read', async () => {
    const a = (await create(dir, { userId: 'u1', kind: 'system', title: 'a' }))!;
    const b = (await create(dir, { userId: 'u1', kind: 'system', title: 'b' }))!;
    expect(await markRead(dir, 'u1', [a.id, b.id])).toBe(2);
    expect(await markRead(dir, 'u1', [a.id, b.id])).toBe(0);
    expect(await unreadCount(dir, 'u1')).toBe(0);
  });

  it('markAllRead clears unread count', async () => {
    await create(dir, { userId: 'u1', kind: 'system', title: 'a' });
    await create(dir, { userId: 'u1', kind: 'system', title: 'b' });
    expect(await markAllRead(dir, 'u1')).toBe(2);
    expect(await unreadCount(dir, 'u1')).toBe(0);
  });

  it('remove and clear delete rows', async () => {
    const a = (await create(dir, { userId: 'u1', kind: 'system', title: 'a' }))!;
    await create(dir, { userId: 'u1', kind: 'system', title: 'b' });
    expect(await remove(dir, 'u1', a.id)).toBe(true);
    expect(await remove(dir, 'u1', a.id)).toBe(false);
    expect(await clear(dir, 'u1')).toBe(1);
    expect(await loadAll(dir, 'u1')).toEqual([]);
  });

  it('trims to MAX_PER_USER on insert', async () => {
    for (let i = 0; i < MAX_PER_USER + 25; i++) {
      await create(dir, { userId: 'u1', kind: 'system', title: `n${i}` }, i);
    }
    const all = await loadAll(dir, 'u1');
    expect(all.length).toBe(MAX_PER_USER);
    // Newest survives.
    expect(all[0].title).toBe(`n${MAX_PER_USER + 24}`);
  });

  it('rejects path-traversal user ids', async () => {
    await expect(create(dir, { userId: '../etc/passwd', kind: 'system', title: 'x' })).rejects.toThrow();
  });

  it('filters by q substring across title and body (case-insensitive)', async () => {
    await create(dir, { userId: 'u1', kind: 'system', title: 'Share viewed', body: 'someone opened your link' }, 1);
    await create(dir, { userId: 'u1', kind: 'webhook.failed', title: 'Webhook failing', body: '500 from receiver' }, 2);
    await create(dir, { userId: 'u1', kind: 'system', title: 'Welcome', body: 'getting started' }, 3);
    const share = await list(dir, 'u1', { q: 'share' });
    expect(share.map((i) => i.title)).toEqual(['Share viewed']);
    const receiver = await list(dir, 'u1', { q: 'RECEIVER' });
    expect(receiver.map((i) => i.title)).toEqual(['Webhook failing']);
    const none = await list(dir, 'u1', { q: 'nope' });
    expect(none).toEqual([]);
    // q combines with unreadOnly.
    await markAllRead(dir, 'u1');
    expect(await list(dir, 'u1', { q: 'share', unreadOnly: true })).toEqual([]);
  });
});
