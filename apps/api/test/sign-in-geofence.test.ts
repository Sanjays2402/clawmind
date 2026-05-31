import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyRecord,
  getRecord,
  replaceRecord,
  validate,
  evaluate,
  resolveCountry,
  diff,
  ALLOWED_HEADERS,
} from '../src/services/sign-in-geofence.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-geo-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('sign-in-geofence service', () => {
  it('starts disabled with an empty country list', async () => {
    const rec = await getRecord(dir);
    expect(rec.enabled).toBe(false);
    expect(rec.countries).toEqual([]);
    expect(rec.mode).toBe('allow');
    expect(rec.requireCountry).toBe(true);
  });

  it('refuses to enable allow-mode with an empty list', () => {
    const v = validate({ enabled: true, mode: 'allow', countries: [] });
    expect(v.ok).toBe(false);
  });

  it('rejects non ISO 3166 codes and duplicates', () => {
    expect(validate({ enabled: true, mode: 'allow', countries: ['USA'] }).ok).toBe(false);
    expect(validate({ enabled: true, mode: 'allow', countries: ['us', 'US'] }).ok).toBe(false);
    expect(validate({ enabled: true, mode: 'block', countries: ['CN', 'RU'] }).ok).toBe(true);
  });

  it('persists policy, normalises country codes and reports a diff', async () => {
    const first = await replaceRecord(dir, 'u-owner', {
      enabled: true,
      mode: 'allow',
      countries: ['us', 'CA'],
    });
    expect(first.countries).toEqual(['US', 'CA']);
    expect(first.updatedBy).toBe('u-owner');
    const second = await replaceRecord(dir, 'u-owner', {
      enabled: true,
      mode: 'allow',
      countries: ['US', 'GB'],
    });
    const d = diff(first, second);
    expect(d.added).toEqual(['GB']);
    expect(d.removed).toEqual(['CA']);
  });

  it('resolves country from any of the default trusted headers', () => {
    expect(resolveCountry({ 'cf-ipcountry': 'us' }, []).country).toBe('US');
    expect(resolveCountry({ 'x-vercel-ip-country': 'DE' }, []).country).toBe('DE');
    expect(resolveCountry({ 'x-forwarded-for': '1.2.3.4' }, []).country).toBe(null);
  });

  it('respects an explicit trustedHeaders override', () => {
    // cf-ipcountry is the default but is NOT in the allowlist, so we
    // must fall back to the override header instead.
    const out = resolveCountry({ 'cf-ipcountry': 'US', 'x-geo': 'JP' }, ['x-geo']);
    expect(out.country).toBe('JP');
    expect(out.source).toBe('x-geo');
  });

  describe('evaluate', () => {
    it('passes through every sign-in when the policy is disabled', () => {
      const r = emptyRecord();
      expect(evaluate(r, { 'cf-ipcountry': 'CN' }).allowed).toBe(true);
    });

    it('allow-mode permits only listed countries', () => {
      const r = { ...emptyRecord(), enabled: true, mode: 'allow' as const, countries: ['US', 'CA'] };
      expect(evaluate(r, { 'cf-ipcountry': 'US' }).allowed).toBe(true);
      const blocked = evaluate(r, { 'cf-ipcountry': 'CN' });
      expect(blocked.allowed).toBe(false);
      expect(blocked.reason).toBe('allow-mode');
      expect(blocked.country).toBe('CN');
    });

    it('block-mode forbids listed countries and permits the rest', () => {
      const r = { ...emptyRecord(), enabled: true, mode: 'block' as const, countries: ['CN', 'RU'] };
      expect(evaluate(r, { 'cf-ipcountry': 'US' }).allowed).toBe(true);
      const blocked = evaluate(r, { 'cf-ipcountry': 'CN' });
      expect(blocked.allowed).toBe(false);
      expect(blocked.reason).toBe('block-mode');
    });

    it('fails closed when requireCountry=true and no header is present', () => {
      const r = { ...emptyRecord(), enabled: true, mode: 'allow' as const, countries: ['US'], requireCountry: true };
      const out = evaluate(r, {});
      expect(out.allowed).toBe(false);
      expect(out.reason).toBe('unknown-country');
    });

    it('falls through when requireCountry=false and no header is present', () => {
      const r = { ...emptyRecord(), enabled: true, mode: 'allow' as const, countries: ['US'], requireCountry: false };
      expect(evaluate(r, {}).allowed).toBe(true);
    });
  });

  it('exposes a non-empty default header list', () => {
    expect(ALLOWED_HEADERS.length).toBeGreaterThan(0);
    expect(ALLOWED_HEADERS).toContain('cf-ipcountry');
  });
});
