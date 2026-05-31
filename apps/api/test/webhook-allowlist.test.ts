import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normaliseHost,
  hostMatches,
  hostAllowed,
  hostnameOf,
  validate,
  replaceRecord,
  getRecord,
  diff,
  checkWebhookUrl,
} from '../src/services/webhook-allowlist.js';
import {
  createWebhook,
  updateWebhook,
  deliverOnce,
  configureWebhookUrlGuard,
  type WebhookRecord,
} from '../src/services/webhooks.js';

// Keep the SSRF guard relaxed so example.com / acme.example.com style
// targets used below do not get filtered for resolving to a private
// address in some CI networks. We are exercising the workspace egress
// allowlist here, not the SSRF guard which has its own dedicated suite.
beforeAll(() => {
  configureWebhookUrlGuard({ allowPrivate: true });
});
afterAll(() => {
  configureWebhookUrlGuard({ allowPrivate: false });
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-whal-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('webhook-allowlist normalisation', () => {
  it('accepts plain hostnames and lower-cases them', () => {
    expect(normaliseHost('Hooks.Acme.com')).toBe('hooks.acme.com');
    expect(normaliseHost(' hooks.acme.com. ')).toBe('hooks.acme.com');
  });

  it('accepts wildcard prefix only as the leftmost label', () => {
    expect(normaliseHost('*.acme.com')).toBe('*.acme.com');
    expect(normaliseHost('api.*.acme.com')).toBeNull();
    expect(normaliseHost('foo*.acme.com')).toBeNull();
  });

  it('rejects URLs, ports, paths, single-label, and garbage', () => {
    expect(normaliseHost('https://hooks.acme.com')).toBeNull();
    expect(normaliseHost('hooks.acme.com:443')).toBeNull();
    expect(normaliseHost('hooks.acme.com/path')).toBeNull();
    expect(normaliseHost('localhost')).toBeNull();
    expect(normaliseHost('')).toBeNull();
    expect(normaliseHost('  ')).toBeNull();
  });
});

describe('webhook-allowlist host matching', () => {
  it('matches exact hosts', () => {
    expect(hostMatches('hooks.acme.com', 'hooks.acme.com')).toBe(true);
    expect(hostMatches('hooks.acme.com', 'evil.com')).toBe(false);
  });

  it('matches *.suffix patterns but not the apex', () => {
    expect(hostMatches('api.acme.com', '*.acme.com')).toBe(true);
    expect(hostMatches('deep.nested.acme.com', '*.acme.com')).toBe(true);
    expect(hostMatches('acme.com', '*.acme.com')).toBe(false);
    expect(hostMatches('evilacme.com', '*.acme.com')).toBe(false);
  });

  it('treats an empty allowlist as deny-all', () => {
    expect(hostAllowed('hooks.acme.com', [])).toBe(false);
  });

  it('extracts hostname from a URL', () => {
    expect(hostnameOf('https://Hooks.Acme.com/path?q=1')).toBe('hooks.acme.com');
    expect(hostnameOf('not a url')).toBeNull();
  });
});

describe('webhook-allowlist validate', () => {
  it('rejects enabling an empty list', () => {
    const v = validate({ enabled: true, hosts: [] });
    expect(v.ok).toBe(false);
  });

  it('rejects duplicates after normalisation', () => {
    const v = validate({
      enabled: true,
      hosts: [{ host: 'Hooks.Acme.com' }, { host: 'hooks.acme.com' }],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.field).toBe('hosts[1].host');
  });

  it('accepts a mix of exact and wildcard hosts', () => {
    const v = validate({
      enabled: true,
      hosts: [
        { host: 'hooks.acme.com', label: 'primary' },
        { host: '*.events.acme.com', label: 'event bus' },
      ],
    });
    expect(v.ok).toBe(true);
  });
});

describe('webhook-allowlist storage + diff', () => {
  it('round-trips a record and reports diffs', async () => {
    const first = await replaceRecord(dir, 'u1', {
      enabled: true,
      hosts: [{ host: 'a.example.com' }, { host: '*.b.example.com' }],
    });
    expect(first.enabled).toBe(true);
    expect(first.hosts).toHaveLength(2);

    const reloaded = await getRecord(dir, 'u1');
    expect(reloaded.hosts.map((h) => h.host).sort()).toEqual(
      ['*.b.example.com', 'a.example.com'],
    );

    const next = await replaceRecord(dir, 'u1', {
      enabled: true,
      hosts: [{ host: 'a.example.com' }, { host: 'c.example.com' }],
    });
    const d = diff(reloaded, next);
    expect(d.added).toEqual(['c.example.com']);
    expect(d.removed).toEqual(['*.b.example.com']);
    expect(d.enabled).toBeNull();
  });

  it('preserves createdAt for hosts carried across edits', async () => {
    const first = await replaceRecord(dir, 'u1', {
      enabled: true,
      hosts: [{ host: 'a.example.com' }],
    });
    const firstTs = first.hosts[0]!.createdAt;
    await new Promise((r) => setTimeout(r, 5));
    const next = await replaceRecord(dir, 'u1', {
      enabled: true,
      hosts: [{ host: 'a.example.com' }, { host: 'b.example.com' }],
    });
    const carried = next.hosts.find((h) => h.host === 'a.example.com')!;
    expect(carried.createdAt).toBe(firstTs);
  });
});

describe('webhook-allowlist enforcement', () => {
  it('allows any host when the allowlist is disabled', async () => {
    const r = await checkWebhookUrl(dir, 'u1', 'https://anywhere.example.com/hook');
    expect(r.allowed).toBe(true);
  });

  it('blocks unlisted hosts when enabled', async () => {
    await replaceRecord(dir, 'u1', {
      enabled: true,
      hosts: [{ host: 'hooks.example.com' }],
    });
    const allow = await checkWebhookUrl(dir, 'u1', 'https://hooks.example.com/x');
    const deny = await checkWebhookUrl(dir, 'u1', 'https://evil.example.org/x');
    expect(allow.allowed).toBe(true);
    expect(deny.allowed).toBe(false);
  });

  it('refuses to register a webhook whose URL is not allowed', async () => {
    await replaceRecord(dir, 'u1', {
      enabled: true,
      hosts: [{ host: 'hooks.example.com' }],
    });
    await expect(
      createWebhook(dir, 'u1', 'https://evil.example.org/x', ['ask.completed']),
    ).rejects.toThrow(/webhook allowlist/);
  });

  it('allows registration when the host matches a wildcard', async () => {
    await replaceRecord(dir, 'u1', {
      enabled: true,
      hosts: [{ host: '*.example.com' }],
    });
    const wh = await createWebhook(
      dir,
      'u1',
      'https://api.example.com/x',
      ['ask.completed'],
    );
    expect(wh.url).toBe('https://api.example.com/x');
  });

  it('refuses an updateWebhook URL change to a disallowed host', async () => {
    const wh = await createWebhook(
      dir,
      'u1',
      'https://hooks.example.com/x',
      ['ask.completed'],
    );
    await replaceRecord(dir, 'u1', {
      enabled: true,
      hosts: [{ host: 'hooks.example.com' }],
    });
    await expect(
      updateWebhook(dir, 'u1', wh.id, { url: 'https://evil.example.org/x' }),
    ).rejects.toThrow(/webhook allowlist/);
  });

  it('blocks in-flight deliveries when the allowlist is tightened later', async () => {
    // Register first (no allowlist), then tighten so the URL is no longer
    // allowed. The next deliverOnce attempt must refuse to send.
    const wh: WebhookRecord = await createWebhook(
      dir,
      'u1',
      'https://hooks.example.com/x',
      ['ask.completed'],
    );
    await replaceRecord(dir, 'u1', {
      enabled: true,
      hosts: [{ host: 'other.example.com' }],
    });

    let fetched = false;
    const fakeFetch = async () => {
      fetched = true;
      return { status: 200 };
    };

    const rec = await deliverOnce(
      dir,
      wh,
      'ask.completed',
      { hello: 'world' },
      fakeFetch as unknown as Parameters<typeof deliverOnce>[4],
    );
    expect(fetched).toBe(false);
    expect(rec.ok).toBe(false);
    expect(rec.status).toBeNull();
    expect(rec.error ?? '').toMatch(/webhook allowlist/);
  });
});
