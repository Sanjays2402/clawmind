import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectAndRecord,
  listForUser,
  listAll,
  acknowledge,
  countOpen,
  haversineKm,
  resolveCountry,
  IMPOSSIBLE_SPEED_KMH,
  _COUNTRY_CENTROIDS,
} from '../src/services/sign-in-anomalies.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-anomalies-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

const now = Date.now();

describe('sign-in anomaly haversine', () => {
  it('computes a known distance within tolerance (NYC to London ~5570 km)', () => {
    const nyc = _COUNTRY_CENTROIDS.US!;
    const lon = _COUNTRY_CENTROIDS.GB!;
    const d = haversineKm(nyc, lon);
    // US centroid is DC, GB is London; great-circle ~5900 km. Loose
    // tolerance because centroids are approximate by design.
    expect(d).toBeGreaterThan(4500);
    expect(d).toBeLessThan(7000);
  });

  it('resolves country from cf-ipcountry header and ignores garbage', () => {
    expect(resolveCountry({ 'cf-ipcountry': 'US' })).toBe('US');
    expect(resolveCountry({ 'x-vercel-ip-country': 'gb' })).toBe('GB');
    expect(resolveCountry({ 'cf-ipcountry': 'XX-not-iso' })).toBeNull();
    expect(resolveCountry({})).toBeNull();
  });
});

describe('impossible-travel detection', () => {
  it('first sign-in records no anomaly but sets the anchor', async () => {
    const out = await detectAndRecord(dir, {
      actor: 'alice', ip: '1.1.1.1', country: 'US', at: now, method: 'github',
    });
    expect(out.kind).toBe('ok');
    const list = await listForUser(dir, 'alice');
    expect(list.records).toHaveLength(0);
  });

  it('flags impossible travel between US and JP one minute apart', async () => {
    await detectAndRecord(dir, { actor: 'alice', ip: '1.1.1.1', country: 'US', at: now, method: 'github' });
    const out = await detectAndRecord(dir, {
      actor: 'alice', ip: '2.2.2.2', country: 'JP', at: now + 5 * 60_000, method: 'github',
    });
    expect(out.kind).toBe('recorded');
    if (out.kind !== 'recorded') return;
    expect(out.record.speedKmh).toBeGreaterThan(IMPOSSIBLE_SPEED_KMH);
    expect(out.record.previous.country).toBe('US');
    expect(out.record.current.country).toBe('JP');
    expect(out.record.acknowledgedAt).toBeNull();
    const list = await listForUser(dir, 'alice');
    expect(list.records).toHaveLength(1);
    expect(list.openCount).toBeUndefined(); // service-level list has no openCount
  });

  it('does not flag travel that is plausible given the elapsed time', async () => {
    // 12 hours between US and GB -> well under threshold
    await detectAndRecord(dir, { actor: 'alice', ip: '1.1.1.1', country: 'US', at: now, method: 'github' });
    const out = await detectAndRecord(dir, {
      actor: 'alice', ip: '2.2.2.2', country: 'GB', at: now + 12 * 60 * 60_000, method: 'github',
    });
    expect(out.kind).toBe('ok');
  });

  it('does not flag two sign-ins from the same country', async () => {
    await detectAndRecord(dir, { actor: 'alice', ip: '1.1.1.1', country: 'US', at: now, method: 'github' });
    const out = await detectAndRecord(dir, {
      actor: 'alice', ip: '1.1.1.2', country: 'US', at: now + 60_000, method: 'github',
    });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.reason).toBe('same-country');
  });

  it('skips when country header is missing (best-effort, no false positives)', async () => {
    await detectAndRecord(dir, { actor: 'alice', ip: '1.1.1.1', country: 'US', at: now, method: 'github' });
    const out = await detectAndRecord(dir, {
      actor: 'alice', ip: '2.2.2.2', country: null, at: now + 60_000, method: 'github',
    });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.reason).toBe('unknown-country');
  });

  it('isolates anomalies across actors: listForUser is single-tenant', async () => {
    // Alice trips an anomaly.
    await detectAndRecord(dir, { actor: 'alice', ip: '1.1.1.1', country: 'US', at: now, method: 'github' });
    await detectAndRecord(dir, { actor: 'alice', ip: '2.2.2.2', country: 'JP', at: now + 60_000, method: 'github' });
    // Bob trips an independent anomaly.
    await detectAndRecord(dir, { actor: 'bob', ip: '3.3.3.3', country: 'BR', at: now, method: 'oidc' });
    await detectAndRecord(dir, { actor: 'bob', ip: '4.4.4.4', country: 'AU', at: now + 90_000, method: 'oidc' });

    const aliceView = await listForUser(dir, 'alice');
    const bobView = await listForUser(dir, 'bob');
    const adminView = await listAll(dir);

    expect(aliceView.records).toHaveLength(1);
    expect(bobView.records).toHaveLength(1);
    expect(adminView.records).toHaveLength(2);
    // Cross-tenant guard: alice must NEVER see bob's anomaly, even
    // though both rows live in the same file.
    expect(aliceView.records.every((r) => r.actor === 'alice')).toBe(true);
    expect(bobView.records.every((r) => r.actor === 'bob')).toBe(true);
    expect(aliceView.records.find((r) => r.actor === 'bob')).toBeUndefined();
    expect(bobView.records.find((r) => r.actor === 'alice')).toBeUndefined();
  });

  it('refuses to let a non-admin acknowledge another user\'s anomaly via self scope', async () => {
    await detectAndRecord(dir, { actor: 'alice', ip: '1.1.1.1', country: 'US', at: now, method: 'github' });
    await detectAndRecord(dir, { actor: 'alice', ip: '2.2.2.2', country: 'JP', at: now + 60_000, method: 'github' });
    const list = await listForUser(dir, 'alice');
    const id = list.records[0]!.id;
    // Bob impersonating self-scope: must be denied.
    const denied = await acknowledge(dir, { id, actor: 'bob', scope: 'self', userId: 'bob' });
    expect(denied).toBeNull();
    const stillOpen = await listForUser(dir, 'alice');
    expect(stillOpen.records[0]!.acknowledgedAt).toBeNull();
    // Admin scope can ack the same row.
    const ack = await acknowledge(dir, { id, actor: 'carol-admin', scope: 'admin', userId: 'carol-admin' });
    expect(ack).not.toBeNull();
    expect(ack!.acknowledgedAt).not.toBeNull();
    expect(ack!.acknowledgedBy).toBe('carol-admin');
  });

  it('countOpen scopes to a user and reflects acknowledgement', async () => {
    await detectAndRecord(dir, { actor: 'alice', ip: '1.1.1.1', country: 'US', at: now, method: 'github' });
    await detectAndRecord(dir, { actor: 'alice', ip: '2.2.2.2', country: 'JP', at: now + 60_000, method: 'github' });
    expect(await countOpen(dir, 'alice')).toBe(1);
    expect(await countOpen(dir, 'bob')).toBe(0);
    const list = await listForUser(dir, 'alice');
    await acknowledge(dir, { id: list.records[0]!.id, actor: 'alice', scope: 'self', userId: 'alice' });
    expect(await countOpen(dir, 'alice')).toBe(0);
  });
});
