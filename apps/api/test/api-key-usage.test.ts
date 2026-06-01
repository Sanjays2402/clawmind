import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordUsage, getUsageReport, purgeUsage, normaliseUa, UA_MAX_LEN } from '../src/services/api-key-usage.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-keyusage-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('api-key-usage service', () => {
  it('returns an empty report when no events were recorded', async () => {
    const r = await getUsageReport(dir, 'k1');
    expect(r.totals.total).toBe(0);
    expect(r.totals.last24h).toBe(0);
    expect(r.recent).toEqual([]);
    expect(r.byRoute).toEqual([]);
    expect(r.totals.firstAt).toBeNull();
  });

  it('aggregates totals, route counts, and recent events newest-first', async () => {
    const now = Date.now();
    await recordUsage(dir, 'k1', { ts: now - 1000, route: '/v1/ask', method: 'POST', status: 200, ms: 12 });
    await recordUsage(dir, 'k1', { ts: now - 500,  route: '/v1/ask', method: 'POST', status: 500, ms: 9 });
    await recordUsage(dir, 'k1', { ts: now - 100,  route: '/v1/search', method: 'GET', status: 200, ms: 3 });

    const r = await getUsageReport(dir, 'k1', { now });
    expect(r.totals.total).toBe(3);
    expect(r.totals.last24h).toBe(3);
    expect(r.totals.last7d).toBe(3);
    expect(r.totals.lastStatusOk).toBe(2);
    expect(r.totals.lastStatusErr).toBe(1);
    expect(r.recent[0]!.route).toBe('/v1/search');
    expect(r.byRoute[0]).toMatchObject({ route: '/v1/ask', method: 'POST', count: 2 });
    expect(r.byRoute[1]).toMatchObject({ route: '/v1/search', method: 'GET', count: 1 });
  });

  it('excludes events outside the 24h and 7d windows from window counters', async () => {
    const now = Date.now();
    const ago2d = now - 2 * 24 * 60 * 60_000;
    const ago10d = now - 10 * 24 * 60 * 60_000;
    await recordUsage(dir, 'k1', { ts: ago10d, route: '/v1/ask', method: 'POST', status: 200, ms: 1 });
    await recordUsage(dir, 'k1', { ts: ago2d,  route: '/v1/ask', method: 'POST', status: 200, ms: 1 });
    await recordUsage(dir, 'k1', { ts: now,    route: '/v1/ask', method: 'POST', status: 200, ms: 1 });
    const r = await getUsageReport(dir, 'k1', { now });
    expect(r.totals.total).toBe(3);
    expect(r.totals.last24h).toBe(1);
    expect(r.totals.last7d).toBe(2);
  });

  it('keeps logs isolated per key', async () => {
    await recordUsage(dir, 'k1', { ts: Date.now(), route: '/v1/ask', method: 'POST', status: 200, ms: 1 });
    await recordUsage(dir, 'k2', { ts: Date.now(), route: '/v1/search', method: 'GET', status: 200, ms: 1 });
    const r1 = await getUsageReport(dir, 'k1');
    const r2 = await getUsageReport(dir, 'k2');
    expect(r1.totals.total).toBe(1);
    expect(r2.totals.total).toBe(1);
    expect(r1.byRoute[0]!.route).toBe('/v1/ask');
    expect(r2.byRoute[0]!.route).toBe('/v1/search');
  });

  it('aggregates source IPs and tolerates events without forensic fields', async () => {
    const now = Date.now();
    // Three calls from one office IP, one from a CI runner, one legacy
    // event with no IP at all (pre-launch log line).
    await recordUsage(dir, 'k1', { ts: now - 4000, route: '/v1/ask',    method: 'POST', status: 200, ms: 5, ip: '203.0.113.7', ua: 'curl/8.4.0' });
    await recordUsage(dir, 'k1', { ts: now - 3000, route: '/v1/search', method: 'GET',  status: 200, ms: 3, ip: '203.0.113.7', ua: 'curl/8.4.0' });
    await recordUsage(dir, 'k1', { ts: now - 2000, route: '/v1/ask',    method: 'POST', status: 200, ms: 4, ip: '203.0.113.7', ua: 'curl/8.4.0' });
    await recordUsage(dir, 'k1', { ts: now - 1500, route: '/v1/ask',    method: 'POST', status: 200, ms: 4, ip: '198.51.100.4', ua: 'ci-runner/1.2' });
    await recordUsage(dir, 'k1', { ts: now - 1000, route: '/v1/ask',    method: 'POST', status: 200, ms: 4 });

    const r = await getUsageReport(dir, 'k1', { now });
    expect(r.uniqueIps).toBe(2);
    expect(r.byIp[0]).toMatchObject({ ip: '203.0.113.7', count: 3 });
    expect(r.byIp[1]).toMatchObject({ ip: '198.51.100.4', count: 1 });
    // The legacy event without IP must not produce a phantom row.
    expect(r.byIp.some((b) => !b.ip)).toBe(false);
    // Recent calls preserve forensic fields newest-first and keep undefined
    // for the legacy event so the UI can render 'unknown' deterministically.
    expect(r.recent[0]!.ip).toBeUndefined();
    expect(r.recent[1]).toMatchObject({ ip: '198.51.100.4', ua: 'ci-runner/1.2' });
    expect(r.recent[2]).toMatchObject({ ip: '203.0.113.7', ua: 'curl/8.4.0' });
  });

  it('keeps forensic logs strictly isolated per key id', async () => {
    // This is the cross-tenant isolation proof: even if the same client IP
    // is used by two keys, a report on key A must never surface events
    // belonging to key B.
    const now = Date.now();
    await recordUsage(dir, 'tenantA', { ts: now - 1000, route: '/v1/ask', method: 'POST', status: 200, ms: 1, ip: '10.0.0.1', ua: 'a-client' });
    await recordUsage(dir, 'tenantB', { ts: now - 500,  route: '/v1/ask', method: 'POST', status: 200, ms: 1, ip: '10.0.0.1', ua: 'b-client' });
    const a = await getUsageReport(dir, 'tenantA', { now });
    const b = await getUsageReport(dir, 'tenantB', { now });
    expect(a.totals.total).toBe(1);
    expect(b.totals.total).toBe(1);
    expect(a.recent.every((ev) => ev.ua === 'a-client')).toBe(true);
    expect(b.recent.every((ev) => ev.ua === 'b-client')).toBe(true);
    // Distinct ip rows but each report sees exactly one event for that IP.
    expect(a.byIp).toEqual([{ ip: '10.0.0.1', count: 1, lastAt: now - 1000 }]);
    expect(b.byIp).toEqual([{ ip: '10.0.0.1', count: 1, lastAt: now - 500 }]);
  });

  it('normalises and truncates the User-Agent before storing it', async () => {
    expect(normaliseUa(undefined)).toBeUndefined();
    expect(normaliseUa('')).toBeUndefined();
    expect(normaliseUa('   ')).toBeUndefined();
    expect(normaliseUa('  curl/8.4.0  ')).toBe('curl/8.4.0');
    const giant = 'X'.repeat(UA_MAX_LEN + 50);
    const out = normaliseUa(giant);
    expect(out).toHaveLength(UA_MAX_LEN);
  });

  it('purges the log on demand without throwing when nothing exists', async () => {
    await recordUsage(dir, 'k1', { ts: Date.now(), route: '/v1/ask', method: 'POST', status: 200, ms: 1 });
    await purgeUsage(dir, 'k1');
    const r = await getUsageReport(dir, 'k1');
    expect(r.totals.total).toBe(0);
    expect(existsSync(join(dir, 'api-key-usage', 'k1.jsonl'))).toBe(false);
    // Idempotent.
    await purgeUsage(dir, 'k1');
  });

  it('ignores corrupt lines in the log', async () => {
    const fs = await import('node:fs/promises');
    const file = join(dir, 'api-key-usage', 'k1.jsonl');
    await fs.mkdir(join(dir, 'api-key-usage'), { recursive: true });
    await fs.writeFile(
      file,
      `not-json\n${JSON.stringify({ ts: Date.now(), route: '/v1/ask', method: 'POST', status: 200, ms: 1 })}\n\n`,
      'utf8',
    );
    const r = await getUsageReport(dir, 'k1');
    expect(r.totals.total).toBe(1);
  });
});
