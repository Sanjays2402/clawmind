import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordUsage, getUsageReport, purgeUsage } from '../src/services/api-key-usage.js';

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
