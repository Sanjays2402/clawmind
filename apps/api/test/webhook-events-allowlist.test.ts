import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getRecord,
  replaceRecord,
  validate,
  checkEvents,
  diff,
} from '../src/services/webhook-events-allowlist.js';
import {
  createWebhook,
  updateWebhook,
  deliverOnce,
} from '../src/services/webhooks.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-whev-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('webhook-events-allowlist service', () => {
  it('defaults to disabled with empty events', async () => {
    const rec = await getRecord(dir, 'u1');
    expect(rec.enabled).toBe(false);
    expect(rec.events).toEqual([]);
  });

  it('rejects enabling with an empty event set', () => {
    const r = validate({ enabled: true, events: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('events');
  });

  it('rejects an unknown event', () => {
    const r = validate({ enabled: true, events: ['nope.boom'] });
    expect(r.ok).toBe(false);
  });

  it('rejects duplicate events', () => {
    const r = validate({ enabled: true, events: ['ask.completed', 'ask.completed'] });
    expect(r.ok).toBe(false);
  });

  it('replaceRecord persists and produces a sane diff', async () => {
    const prev = await getRecord(dir, 'u1');
    const next = await replaceRecord(dir, 'u1', {
      enabled: true,
      events: ['ask.completed', 'ingest.completed'],
    });
    expect(next.enabled).toBe(true);
    expect(next.events).toEqual(['ask.completed', 'ingest.completed']);
    const d = diff(prev, next);
    expect(d.enabled).toEqual({ from: false, to: true });
    expect(d.added.sort()).toEqual(['ask.completed', 'ingest.completed'].sort());
    expect(d.removed).toEqual([]);

    // Disk round-trip survives.
    const reread = await getRecord(dir, 'u1');
    expect(reread.events).toEqual(next.events);
  });

  it('checkEvents short-circuits to allowed when disabled', async () => {
    const r = await checkEvents(dir, 'u1', ['ask.completed', 'audit.event']);
    expect(r.allowed).toBe(true);
  });

  it('checkEvents denies events outside the workspace allowlist', async () => {
    await replaceRecord(dir, 'u1', { enabled: true, events: ['ingest.completed'] });
    const r = await checkEvents(dir, 'u1', ['ask.completed']);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.denied).toEqual(['ask.completed']);
  });

  it('records are per-workspace, not global', async () => {
    await replaceRecord(dir, 'u1', { enabled: true, events: ['ingest.completed'] });
    // u2 must not inherit u1's restriction.
    const r = await checkEvents(dir, 'u2', ['ask.completed']);
    expect(r.allowed).toBe(true);
  });
});

describe('webhooks integration with event allowlist', () => {
  it('createWebhook is blocked when the event is not allowed', async () => {
    await replaceRecord(dir, 'u1', { enabled: true, events: ['ingest.completed'] });
    await expect(
      createWebhook(dir, 'u1', 'https://example.com/h', ['ask.completed']),
    ).rejects.toThrow(/event allowlist/);
  });

  it('createWebhook succeeds when every subscribed event is allowed', async () => {
    await replaceRecord(dir, 'u1', {
      enabled: true,
      events: ['ask.completed', 'ingest.completed'],
    });
    const wh = await createWebhook(dir, 'u1', 'https://example.com/h', [
      'ask.completed',
    ]);
    expect(wh.id).toMatch(/^wh_/);
  });

  it('updateWebhook events patch is blocked when introducing a denied event', async () => {
    const wh = await createWebhook(dir, 'u1', 'https://example.com/h', ['ingest.completed']);
    await replaceRecord(dir, 'u1', { enabled: true, events: ['ingest.completed'] });
    await expect(
      updateWebhook(dir, 'u1', wh.id, { events: ['ask.completed'] }),
    ).rejects.toThrow(/event allowlist/);
  });

  it('deliverOnce hard-fails (no HTTP call) when the event was removed from the allowlist', async () => {
    // Subscribe while everything is allowed.
    const wh = await createWebhook(dir, 'u1', 'https://example.com/h', ['ask.completed']);
    // Owner later tightens the allowlist to exclude ask.completed.
    await replaceRecord(dir, 'u1', { enabled: true, events: ['ingest.completed'] });
    let called = 0;
    const fakeFetch = async () => {
      called++;
      return { status: 200 };
    };
    const rec = await deliverOnce(dir, wh, 'ask.completed', { answer: 'leak?' }, fakeFetch);
    expect(rec.ok).toBe(false);
    expect(rec.status).toBeNull();
    expect(rec.error).toMatch(/event allowlist/);
    expect(called).toBe(0);
  });

  it('cross-workspace isolation: u2 allowlist does not affect u1 deliveries', async () => {
    const wh = await createWebhook(dir, 'u1', 'https://example.com/h', ['ask.completed']);
    // u2 locks themselves down; must not influence u1.
    await replaceRecord(dir, 'u2', { enabled: true, events: ['ingest.completed'] });
    let called = 0;
    const fakeFetch = async () => {
      called++;
      return { status: 200 };
    };
    const rec = await deliverOnce(dir, wh, 'ask.completed', { x: 1 }, fakeFetch);
    expect(rec.ok).toBe(true);
    expect(called).toBe(1);
  });
});
