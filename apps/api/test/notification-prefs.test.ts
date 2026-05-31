import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getPreferences,
  setPreferences,
  shouldDeliver,
  defaultPrefs,
  KNOWN_KINDS,
} from '../src/services/notification-prefs.js';
import { create, list } from '../src/services/notifications.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-notif-prefs-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('notification preferences service', () => {
  it('returns defaults (everything enabled) without writing on first read', async () => {
    const p = await getPreferences(dir, 'alice');
    expect(p.userId).toBe('alice');
    expect(p.updatedAt).toBe(0);
    for (const k of KNOWN_KINDS) {
      expect(p.prefs[k]).toBe(true);
    }
    expect(existsSync(join(dir, 'notification-prefs', 'alice.json'))).toBe(false);
  });

  it('persists a partial update and leaves untouched kinds enabled', async () => {
    const saved = await setPreferences(dir, 'alice', {
      prefs: { 'webhook.failed': false },
    });
    expect(saved.prefs['webhook.failed']).toBe(false);
    expect(saved.prefs['share.viewed']).toBe(true);
    const fresh = await getPreferences(dir, 'alice');
    expect(fresh.prefs['webhook.failed']).toBe(false);
    expect(fresh.prefs['share.viewed']).toBe(true);
  });

  it('isolates preferences per user', async () => {
    await setPreferences(dir, 'alice', { prefs: { 'share.viewed': false } });
    const a = await getPreferences(dir, 'alice');
    const b = await getPreferences(dir, 'bob');
    expect(a.prefs['share.viewed']).toBe(false);
    expect(b.prefs['share.viewed']).toBe(true);
  });

  it('shouldDeliver gates a muted kind and lets enabled kinds through', async () => {
    await setPreferences(dir, 'alice', { prefs: { 'share.viewed': false } });
    expect(await shouldDeliver(dir, 'alice', 'share.viewed')).toBe(false);
    expect(await shouldDeliver(dir, 'alice', 'webhook.failed')).toBe(true);
    expect(await shouldDeliver(dir, 'bob', 'share.viewed')).toBe(true);
  });

  it('notifications.create drops a row when the user has muted that kind', async () => {
    await setPreferences(dir, 'alice', { prefs: { 'share.viewed': false } });
    const muted = await create(dir, {
      userId: 'alice',
      kind: 'share.viewed',
      title: 'someone viewed your share',
    });
    expect(muted).toBeNull();
    expect(await list(dir, 'alice')).toEqual([]);

    const ok = await create(dir, {
      userId: 'alice',
      kind: 'system',
      title: 'maintenance window tonight',
    });
    expect(ok).not.toBeNull();
    const inbox2 = await list(dir, 'alice');
    expect(inbox2).toHaveLength(1);
    expect(inbox2[0].title).toBe('maintenance window tonight');
  });

  it('rejects path-traversal user ids', async () => {
    await expect(
      setPreferences(dir, '../etc/passwd', { prefs: { system: false } }),
    ).rejects.toThrow();
  });

  it('defaultPrefs returns every known kind enabled', () => {
    const d = defaultPrefs();
    for (const k of KNOWN_KINDS) {
      expect(d[k]).toBe(true);
    }
  });
});
