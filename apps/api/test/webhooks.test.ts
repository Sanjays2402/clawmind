import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWebhook, listForUser, updateWebhook, deleteWebhook,
  emit, deliverOnce, listDeliveries, redeliver, sign, verify, WEBHOOK_EVENTS,
  rotateSecret, loadAll,
} from '../src/services/webhooks.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-wh-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('webhooks service', () => {
  it('signs and verifies a payload round-trip', () => {
    const body = JSON.stringify({ hello: 'world' });
    const header = sign('whsec_abc', body, 1_700_000_000_000);
    expect(verify('whsec_abc', body, header, Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(verify('whsec_wrong', body, header, Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(verify('whsec_abc', body + 'tampered', header, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it('rejects an invalid url at creation', async () => {
    await expect(
      createWebhook(dir, 'u1', 'not-a-url', ['ask.completed']),
    ).rejects.toThrow(/invalid url/);
  });

  it('rejects an unknown event', async () => {
    await expect(
      // @ts-expect-error testing runtime guard
      createWebhook(dir, 'u1', 'https://example.com/h', ['nope.boom']),
    ).rejects.toThrow(/unknown event/);
  });

  it('creates, lists, updates, and deletes a subscription', async () => {
    const wh = await createWebhook(dir, 'u1', 'https://example.com/h', ['ask.completed']);
    expect(wh.id).toMatch(/^wh_/);
    expect(wh.secret).toMatch(/^whsec_/);
    expect(wh.active).toBe(true);

    const list = await listForUser(dir, 'u1');
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(wh.id);

    // Cross-user isolation: u2 must not see u1's webhook.
    expect(await listForUser(dir, 'u2')).toEqual([]);

    const updated = await updateWebhook(dir, 'u1', wh.id, { active: false });
    expect(updated?.active).toBe(false);

    const gone = await deleteWebhook(dir, 'u1', wh.id);
    expect(gone).toBe(true);
    expect(await listForUser(dir, 'u1')).toEqual([]);
  });

  it('exposes the known event catalogue', () => {
    expect(WEBHOOK_EVENTS).toContain('ask.completed');
  });

  it('deliverOnce writes a delivery row and signs the request', async () => {
    const wh = await createWebhook(dir, 'u1', 'https://example.com/h', ['ask.completed']);
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = '';
    const fakeFetch = async (_url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => {
      capturedHeaders = init.headers;
      capturedBody = init.body;
      return { status: 200 };
    };
    const rec = await deliverOnce(dir, wh, 'ask.completed', { answer: 'hi' }, fakeFetch);
    expect(rec.ok).toBe(true);
    expect(rec.status).toBe(200);
    expect(rec.attempt).toBe(1);
    expect(capturedHeaders['x-clawmind-signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verify(wh.secret, capturedBody, capturedHeaders['x-clawmind-signature']!, Number.MAX_SAFE_INTEGER)).toBe(true);

    const log = await listDeliveries(dir, 'u1');
    expect(log).toHaveLength(1);
    expect(log[0]!.ok).toBe(true);

    // Delivery log file should exist on disk.
    expect(existsSync(join(dir, 'webhook-deliveries.jsonl'))).toBe(true);
  });

  it('retries on 5xx and gives up after MAX_ATTEMPTS', async () => {
    const wh = await createWebhook(dir, 'u1', 'https://example.com/h', ['ask.completed']);
    let calls = 0;
    const fakeFetch = async () => { calls += 1; return { status: 503 }; };
    const rec = await deliverOnce(dir, wh, 'ask.completed', {}, fakeFetch);
    expect(calls).toBe(3);
    expect(rec.ok).toBe(false);
    expect(rec.status).toBe(503);
    const log = await listDeliveries(dir, 'u1');
    // Each attempt should log its own row so users can see all three.
    expect(log.length).toBe(3);
  });

  it('does not retry 4xx responses', async () => {
    const wh = await createWebhook(dir, 'u1', 'https://example.com/h', ['ask.completed']);
    let calls = 0;
    const fakeFetch = async () => { calls += 1; return { status: 404 }; };
    const rec = await deliverOnce(dir, wh, 'ask.completed', {}, fakeFetch);
    expect(calls).toBe(1);
    expect(rec.ok).toBe(false);
    expect(rec.status).toBe(404);
  });

  it('emit() only fires for matching event + active + correct user', async () => {
    const a = await createWebhook(dir, 'u1', 'https://a/', ['ask.completed']);
    const b = await createWebhook(dir, 'u1', 'https://b/', ['ingest.completed']);
    const c = await createWebhook(dir, 'u2', 'https://c/', ['ask.completed']);
    await updateWebhook(dir, 'u1', a.id, { active: true });
    void b; void c;
    const hits: string[] = [];
    const fakeFetch = async (url: string) => { hits.push(url); return { status: 200 }; };
    await emit(dir, 'ask.completed', { x: 1 }, 'u1', fakeFetch);
    expect(hits).toEqual(['https://a/']);
  });

  it('emit() persists last status + failure counter', async () => {
    const wh = await createWebhook(dir, 'u1', 'https://x/', ['ask.completed']);
    const fakeFetch = async () => { throw new Error('econnrefused'); };
    await emit(dir, 'ask.completed', { x: 1 }, 'u1', fakeFetch);
    const raw = JSON.parse(readFileSync(join(dir, 'webhooks.json'), 'utf8')) as Array<{ id: string; failureCount: number; lastStatus: number | null }>;
    const row = raw.find((r) => r.id === wh.id)!;
    expect(row.failureCount).toBe(1);
    expect(row.lastStatus).toBeNull();
  });

  it('redeliver replays the original payload and links to its parent', async () => {
    const wh = await createWebhook(dir, 'u1', 'https://example.com/h', ['ask.completed']);
    // First attempt fails so we have a real "this one didn't land" row to replay.
    let phase: 'fail' | 'pass' = 'fail';
    const capturedBodies: string[] = [];
    const fakeFetch = async (_u: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => {
      capturedBodies.push(init.body);
      return phase === 'fail' ? { status: 500 } : { status: 200 };
    };
    await deliverOnce(dir, wh, 'ask.completed', { answer: 'hello', n: 7 }, fakeFetch);
    const before = await listDeliveries(dir, 'u1');
    // Latest row first; pick the original failed delivery (no parentId).
    const original = before.find((d) => !d.parentId)!;
    expect(original.ok).toBe(false);
    expect(original.payload).toEqual({ answer: 'hello', n: 7 });

    phase = 'pass';
    const result = await redeliver(dir, 'u1', original.id, fakeFetch);
    expect('delivery' in result).toBe(true);
    if (!('delivery' in result)) throw new Error('unreachable');
    expect(result.delivery.ok).toBe(true);
    expect(result.delivery.parentId).toBe(original.id);
    // Replay body must carry the same `data` field as the original POST.
    const replayBody = JSON.parse(capturedBodies[capturedBodies.length - 1]!);
    expect(replayBody.data).toEqual({ answer: 'hello', n: 7 });
    expect(replayBody.event).toBe('ask.completed');
  });

  it('redeliver refuses unknown ids and cross-user access', async () => {
    const wh = await createWebhook(dir, 'u1', 'https://example.com/h', ['ask.completed']);
    const fakeFetch = async () => ({ status: 200 });
    await deliverOnce(dir, wh, 'ask.completed', { ok: 1 }, fakeFetch);
    const [row] = await listDeliveries(dir, 'u1');
    // Other user must not be able to replay u1's delivery.
    const denied = await redeliver(dir, 'u2', row!.id, fakeFetch);
    expect(denied).toEqual({ error: 'not_found' });
    const missing = await redeliver(dir, 'u1', 'dlv_nope', fakeFetch);
    expect(missing).toEqual({ error: 'not_found' });
  });

  it('rotateSecret keeps the old secret valid during the grace window and signs deliveries with both', async () => {
    const wh = await createWebhook(dir, 'u1', 'https://example.com/h', ['ask.completed']);
    const oldSecret = wh.secret;

    const rotated = await rotateSecret(dir, 'u1', wh.id, 60 * 60_000);
    expect(rotated).not.toBeNull();
    expect(rotated!.secret).not.toEqual(oldSecret);
    expect(rotated!.previousSecret).toEqual(oldSecret);
    expect(rotated!.previousSecretExpiresAt).toBeGreaterThan(Date.now());

    // Capture the outbound headers from one delivery.
    let captured: Record<string, string> = {};
    let capturedBody = '';
    const fakeFetch = async (
      _u: string,
      init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
    ) => {
      captured = init.headers;
      capturedBody = init.body;
      return { status: 200 };
    };
    const fresh = (await loadAll(dir)).find((w) => w.id === wh.id)!;
    const rec = await deliverOnce(dir, fresh, 'ask.completed', { ok: true }, fakeFetch);
    expect(rec.ok).toBe(true);
    expect(captured['x-clawmind-signature']).toBeTruthy();
    expect(captured['x-clawmind-signature-prev']).toBeTruthy();

    // Receiver in the middle of a rolling deploy: still validating with the
    // old secret. The new sig must NOT validate against the old secret, but
    // the prev sig must. That is the whole point of dual-signing.
    const newSig = captured['x-clawmind-signature']!;
    const prevSig = captured['x-clawmind-signature-prev']!;
    expect(verify(oldSecret, capturedBody, prevSig, Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(verify(oldSecret, capturedBody, newSig, Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(verify(fresh.secret, capturedBody, newSig, Number.MAX_SAFE_INTEGER)).toBe(true);

    // verify() also accepts a previousSecret arg so a receiver that wraps it
    // can keep accepting either header during the cutover.
    expect(verify(fresh.secret, capturedBody, prevSig, Number.MAX_SAFE_INTEGER, oldSecret)).toBe(true);
  });

  it('rotateSecret drops the previous secret once the grace window expires', async () => {
    const wh = await createWebhook(dir, 'u1', 'https://example.com/h', ['ask.completed']);
    const oldSecret = wh.secret;
    // 1ms grace, then wait it out: previousSecret must be expired and so
    // dropped before the next deliverOnce signs the request.
    await rotateSecret(dir, 'u1', wh.id, 60_000);
    // Manually shove the expiry into the past to simulate elapsed time
    // without sleeping in tests.
    const all = await loadAll(dir);
    const target = all.find((w) => w.id === wh.id)!;
    target.previousSecretExpiresAt = Date.now() - 1;
    // re-save through the public update path is overkill; just write file
    const fs = await import('node:fs/promises');
    await fs.writeFile(`${dir}/webhooks.json`, JSON.stringify(all, null, 2));

    let captured: Record<string, string> = {};
    const fakeFetch = async (
      _u: string,
      init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
    ) => { captured = init.headers; return { status: 200 }; };
    const fresh = (await loadAll(dir)).find((w) => w.id === wh.id)!;
    await deliverOnce(dir, fresh, 'ask.completed', { ok: true }, fakeFetch);
    expect(captured['x-clawmind-signature']).toBeTruthy();
    expect(captured['x-clawmind-signature-prev']).toBeUndefined();
    // Confirm the expired previousSecret is no longer on the in-memory
    // record either (so future signs cannot accidentally use it).
    expect(fresh.previousSecret).toBeUndefined();
    // The expired old secret is also useless against the new signature.
    expect(verify(oldSecret, '{}', captured['x-clawmind-signature']!, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it('rotateSecret refuses to act on a webhook the caller does not own', async () => {
    const wh = await createWebhook(dir, 'u1', 'https://example.com/h', ['ask.completed']);
    const result = await rotateSecret(dir, 'u2', wh.id);
    expect(result).toBeNull();
    // u1's secret must be untouched.
    const stillMine = (await listForUser(dir, 'u1'))[0]!;
    expect(stillMine.secret).toEqual(wh.secret);
    expect(stillMine.previousSecret).toBeUndefined();
  });

  it('filters list by q substring across url and events (case-insensitive)', async () => {
    await createWebhook(dir, 'u1', 'https://example.com/alerts', ['ask.completed']);
    await createWebhook(dir, 'u1', 'https://hooks.slack.com/x', ['audit.event']);
    await createWebhook(dir, 'u1', 'https://example.com/billing', ['ingest.completed']);
    // url match
    const slack = await listForUser(dir, 'u1', { q: 'SLACK' });
    expect(slack.map((w) => w.url)).toEqual(['https://hooks.slack.com/x']);
    // event match
    const auditOnly = await listForUser(dir, 'u1', { q: 'audit' });
    expect(auditOnly.map((w) => w.url)).toEqual(['https://hooks.slack.com/x']);
    // partial url
    const billing = await listForUser(dir, 'u1', { q: 'bill' });
    expect(billing.map((w) => w.url)).toEqual(['https://example.com/billing']);
    // no match
    expect(await listForUser(dir, 'u1', { q: 'nope' })).toEqual([]);
    // cross-user isolation still applies under q
    expect(await listForUser(dir, 'u2', { q: 'slack' })).toEqual([]);
  });
});
