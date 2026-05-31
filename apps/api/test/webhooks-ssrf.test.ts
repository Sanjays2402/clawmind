import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  configureWebhookUrlGuard,
  createWebhook,
  deliverOnce,
  updateWebhook,
} from '../src/services/webhooks.js';
import {
  parseSafeUrl,
  assertPublicUrl,
  isPrivateIp,
  UnsafeUrlError,
} from '../src/services/url-guard.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-ssrf-'));
  // Deny private addresses for this suite, matching production.
  configureWebhookUrlGuard({ allowPrivate: false });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  // Restore the test-friendly default so the rest of the suite stays green.
  configureWebhookUrlGuard({ allowPrivate: true });
});

describe('url-guard', () => {
  it('flags private and reserved ranges as private', () => {
    for (const ip of [
      '127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.254',
      '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
      '224.0.0.1', '255.255.255.255',
      '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
      '::ffff:127.0.0.1', '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  it('treats public addresses as public', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });

  it('rejects bad scheme, credentials, disallowed ports', () => {
    expect(() => parseSafeUrl('ftp://example.com/x')).toThrow(UnsafeUrlError);
    expect(() => parseSafeUrl('file:///etc/passwd')).toThrow(UnsafeUrlError);
    expect(() => parseSafeUrl('http://user:pass@example.com/')).toThrow(UnsafeUrlError);
    expect(() => parseSafeUrl('http://example.com:22/')).toThrow(UnsafeUrlError);
    expect(() => parseSafeUrl('http://example.com:6379/')).toThrow(UnsafeUrlError);
  });

  it('rejects literal private IPs in URLs without touching DNS', async () => {
    await expect(assertPublicUrl('http://127.0.0.1/x')).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicUrl('http://10.0.0.1/x')).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      UnsafeUrlError,
    );
    await expect(assertPublicUrl('http://[::1]/x')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects cloud metadata hostnames even when allowPrivate=true', async () => {
    await expect(
      assertPublicUrl('http://metadata.google.internal/', { allowPrivate: true }),
    ).rejects.toThrow(UnsafeUrlError);
    await expect(
      assertPublicUrl('http://169.254.169.254/', { allowPrivate: true }),
    ).rejects.toThrow(UnsafeUrlError);
  });
});

describe('webhook SSRF enforcement', () => {
  it('refuses to register a webhook that points at loopback', async () => {
    await expect(
      createWebhook(dir, 'u1', 'http://127.0.0.1:80/hook', ['ask.completed']),
    ).rejects.toThrow(/unsafe url/);
  });

  it('refuses to register a webhook that points at RFC1918', async () => {
    await expect(
      createWebhook(dir, 'u1', 'http://10.0.0.5/hook', ['ask.completed']),
    ).rejects.toThrow(/unsafe url/);
  });

  it('refuses to register a webhook that points at the cloud metadata endpoint', async () => {
    await expect(
      createWebhook(dir, 'u1', 'http://169.254.169.254/latest/meta-data/', ['ask.completed']),
    ).rejects.toThrow(/unsafe url/);
  });

  it('refuses to UPDATE a webhook to a private URL', async () => {
    // Allow the initial public registration.
    configureWebhookUrlGuard({ allowPrivate: true });
    const wh = await createWebhook(dir, 'u1', 'https://example.com/hook', ['ask.completed']);
    // Now lock it back down and try to swap the URL to something internal.
    configureWebhookUrlGuard({ allowPrivate: false });
    await expect(
      updateWebhook(dir, 'u1', wh.id, { url: 'http://10.0.0.5/hook' }),
    ).rejects.toThrow(/unsafe url/);
  });

  it('blocks delivery (no fetch attempted) when the URL is private', async () => {
    // Register while private is allowed, then enforce on delivery.
    configureWebhookUrlGuard({ allowPrivate: true });
    const wh = await createWebhook(dir, 'u1', 'http://127.0.0.1:8080/hook', ['ask.completed']);
    configureWebhookUrlGuard({ allowPrivate: false });
    let fetchCalls = 0;
    const result = await deliverOnce(dir, wh, 'ask.completed', { hello: 'world' }, async () => {
      fetchCalls += 1;
      return { status: 200 };
    });
    expect(fetchCalls).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.error || '').toMatch(/blocked/);
  });
});
