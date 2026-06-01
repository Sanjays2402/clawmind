import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  issueKey,
  issueCanaryKey,
  listKeys,
  listCanaryKeys,
  verifySecret,
  redact,
} from '../src/services/api-keys.js';
import {
  recordIncident,
  listIncidents,
  clearIncidents,
  HONEYTOKEN_INCIDENT_CAP,
} from '../src/services/api-key-honeytokens.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-honey-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('api-key honeytokens', () => {
  it('mints a canary key with the same wire shape as a real key', async () => {
    const c = await issueCanaryKey(dir, { userId: 'u1', label: 'planted-in-legacy-repo' });
    expect(c.secret.startsWith('cm_')).toBe(true);
    expect(c.record.isCanary).toBe(true);
    const r = redact(c.record);
    expect(r.isCanary).toBe(true);
  });

  it('hides canary keys from the regular listKeys surface', async () => {
    await issueKey(dir, { userId: 'u1', label: 'real-cli' });
    await issueCanaryKey(dir, { userId: 'u1', label: 'trap-1' });
    await issueCanaryKey(dir, { userId: 'u1', label: 'trap-2' });
    const list = await listKeys(dir, 'u1');
    expect(list.map((k) => k.label)).toEqual(['real-cli']);
    const canaries = await listCanaryKeys(dir, 'u1');
    expect(canaries.map((k) => k.label).sort()).toEqual(['trap-1', 'trap-2']);
  });

  it('canary keys verify positively at the secret layer (auth plugin handles the trip)', async () => {
    const c = await issueCanaryKey(dir, { userId: 'u1', label: 'planted' });
    const v = await verifySecret(dir, c.secret);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.record.isCanary).toBe(true);
      expect(v.record.id).toBe(c.record.id);
    }
  });

  it('records incidents newest-first, capped at HONEYTOKEN_INCIDENT_CAP', async () => {
    const c = await issueCanaryKey(dir, { userId: 'u1', label: 'trap' });
    await recordIncident(dir, {
      keyId: c.record.id,
      keyLabel: c.record.label,
      ip: '203.0.113.5',
      route: '/v1/ask',
      method: 'POST',
      userAgent: 'curl/8.4',
      requestId: 'req-1',
      now: 1_000,
    });
    await recordIncident(dir, {
      keyId: c.record.id,
      keyLabel: c.record.label,
      ip: '203.0.113.6',
      route: '/v1/search',
      now: 2_000,
    });
    const items = await listIncidents(dir);
    expect(items).toHaveLength(2);
    expect(items[0]!.tippedAt).toBe(2_000); // newest first
    expect(items[1]!.ip).toBe('203.0.113.5');
  });

  it('truncates over-long user-agent strings to 256 chars', async () => {
    const c = await issueCanaryKey(dir, { userId: 'u1', label: 't' });
    const ua = 'A'.repeat(400);
    await recordIncident(dir, { keyId: c.record.id, keyLabel: c.record.label, userAgent: ua });
    const items = await listIncidents(dir);
    expect(items[0]!.userAgent!.length).toBe(256);
  });

  it('respects the cap, dropping oldest entries on overflow', async () => {
    const c = await issueCanaryKey(dir, { userId: 'u1', label: 't' });
    for (let i = 0; i < HONEYTOKEN_INCIDENT_CAP + 5; i++) {
      await recordIncident(dir, {
        keyId: c.record.id,
        keyLabel: c.record.label,
        ip: `10.0.0.${i % 250}`,
        now: 1_000 + i,
      });
    }
    const items = await listIncidents(dir);
    expect(items.length).toBe(HONEYTOKEN_INCIDENT_CAP);
    // Oldest of the survivors must be one of the late inserts.
    expect(items[0]!.tippedAt).toBe(1_000 + HONEYTOKEN_INCIDENT_CAP + 4);
  });

  it('filters by keyId', async () => {
    const a = await issueCanaryKey(dir, { userId: 'u1', label: 'a' });
    const b = await issueCanaryKey(dir, { userId: 'u1', label: 'b' });
    await recordIncident(dir, { keyId: a.record.id, keyLabel: a.record.label });
    await recordIncident(dir, { keyId: b.record.id, keyLabel: b.record.label });
    await recordIncident(dir, { keyId: a.record.id, keyLabel: a.record.label });
    const onlyA = await listIncidents(dir, { keyId: a.record.id });
    expect(onlyA).toHaveLength(2);
    expect(onlyA.every((x) => x.keyId === a.record.id)).toBe(true);
  });

  it('clearIncidents drops everything and returns the removed count', async () => {
    const c = await issueCanaryKey(dir, { userId: 'u1', label: 't' });
    await recordIncident(dir, { keyId: c.record.id, keyLabel: c.record.label });
    await recordIncident(dir, { keyId: c.record.id, keyLabel: c.record.label });
    expect(await clearIncidents(dir)).toBe(2);
    expect(await listIncidents(dir)).toEqual([]);
    expect(await clearIncidents(dir)).toBe(0);
  });
});
