import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWebhook,
  updateWebhook,
  emitToAll,
  WEBHOOK_EVENTS,
  configureWebhookUrlGuard,
} from '../src/services/webhooks.js';

// Tests rely on private hosts being reachable (https://a/, https://b/...)
// so toggle the SSRF guard the same way webhook-allowlist.test.ts does.
beforeAll(() => {
  configureWebhookUrlGuard({ allowPrivate: true });
});
afterAll(() => {
  configureWebhookUrlGuard({ allowPrivate: false });
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-wh-audit-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('audit.event webhook fan-out', () => {
  it('lists audit.event in the supported events catalogue', () => {
    expect(WEBHOOK_EVENTS).toContain('audit.event');
  });

  it('emitToAll fires across every owner and skips non-matching / inactive subs', async () => {
    // SIEM connector installed by owner u1, listening for audit.event.
    const siemA = await createWebhook(dir, 'u1', 'https://siem-a/', ['audit.event']);
    // A second workspace owner with their own SIEM also wired up.
    const siemB = await createWebhook(dir, 'u2', 'https://siem-b/', ['audit.event']);
    // A subscriber that only cares about ask.completed must not receive audit events.
    await createWebhook(dir, 'u1', 'https://ask-only/', ['ask.completed']);
    // Inactive audit subscriber: should be skipped even though it matches.
    const paused = await createWebhook(dir, 'u3', 'https://paused/', ['audit.event']);
    await updateWebhook(dir, 'u3', paused.id, { active: false });

    void siemA; void siemB;

    const hits: string[] = [];
    const fakeFetch = async (url: string) => { hits.push(url); return { status: 200 }; };

    await emitToAll(
      dir,
      'audit.event',
      { event: { id: 'evt_1', action: 'keys.create', actor: 'u1' } },
      fakeFetch,
    );

    expect(hits.sort()).toEqual(['https://siem-a/', 'https://siem-b/']);
  });

  it('emitToAll isolates per-subscriber failures', async () => {
    await createWebhook(dir, 'u1', 'https://ok/', ['audit.event']);
    await createWebhook(dir, 'u2', 'https://broken/', ['audit.event']);

    const hits: string[] = [];
    const fakeFetch = async (url: string) => {
      hits.push(url);
      if (url.includes('broken')) throw new Error('econnrefused');
      return { status: 200 };
    };

    // Must not throw even though one receiver explodes.
    await expect(
      emitToAll(dir, 'audit.event', { event: { id: 'x' } }, fakeFetch),
    ).resolves.toBeUndefined();
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(new Set(hits).size).toBe(2);
  });
});
