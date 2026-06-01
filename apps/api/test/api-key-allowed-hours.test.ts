import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  issueKey,
  setKeyAllowedHours,
  normaliseAllowedHours,
  withinAllowedHours,
  loadKeys,
  MAX_KEY_HOURS_WINDOWS,
} from '../src/services/api-keys.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-key-hours-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('api-key per-key allowed-hours policy', () => {
  it('normalises a clean policy, dedupes and sorts days', () => {
    const v = normaliseAllowedHours({
      tz: 'UTC',
      windows: [{ days: [3, 1, 1, 5], startMin: 540, endMin: 1080 }],
    });
    expect(v.ok).toBe(true);
    expect(v.policy?.tz).toBe('UTC');
    expect(v.policy?.windows[0]!.days).toEqual([1, 3, 5]);
  });

  it('rejects an unknown timezone', () => {
    const v = normaliseAllowedHours({ tz: 'Not/AZone', windows: [{ days: [1], startMin: 0, endMin: 10 }] });
    expect(v.ok).toBe(false);
  });

  it('rejects start >= end (overnight must be split)', () => {
    const v = normaliseAllowedHours({ tz: 'UTC', windows: [{ days: [1], startMin: 1200, endMin: 600 }] });
    expect(v.ok).toBe(false);
  });

  it('rejects too many windows', () => {
    const windows = Array.from({ length: MAX_KEY_HOURS_WINDOWS + 1 }, () => ({
      days: [1],
      startMin: 0,
      endMin: 1,
    }));
    const v = normaliseAllowedHours({ tz: 'UTC', windows });
    expect(v.ok).toBe(false);
  });

  it('rejects out-of-range days/minutes', () => {
    expect(normaliseAllowedHours({ tz: 'UTC', windows: [{ days: [7], startMin: 0, endMin: 1 }] }).ok).toBe(false);
    expect(normaliseAllowedHours({ tz: 'UTC', windows: [{ days: [1], startMin: -1, endMin: 1 }] }).ok).toBe(false);
    expect(normaliseAllowedHours({ tz: 'UTC', windows: [{ days: [1], startMin: 0, endMin: 1441 }] }).ok).toBe(false);
  });

  it('unrestricted key passes withinAllowedHours unconditionally', () => {
    expect(withinAllowedHours(null)).toBe(true);
    expect(withinAllowedHours(undefined)).toBe(true);
    expect(withinAllowedHours({ tz: 'UTC', windows: [] })).toBe(true);
  });

  it('admits and denies based on weekday and time-of-day in tz', () => {
    // Mon 09:00..18:00 UTC.
    const policy = { tz: 'UTC', windows: [{ days: [1], startMin: 540, endMin: 1080 }] };
    // 2024-01-01 was a Monday.
    expect(withinAllowedHours(policy, new Date('2024-01-01T09:00:00Z'))).toBe(true);
    expect(withinAllowedHours(policy, new Date('2024-01-01T17:59:00Z'))).toBe(true);
    expect(withinAllowedHours(policy, new Date('2024-01-01T18:00:00Z'))).toBe(false);
    expect(withinAllowedHours(policy, new Date('2024-01-01T08:59:00Z'))).toBe(false);
    // Tuesday at the same time is outside the Mon-only window.
    expect(withinAllowedHours(policy, new Date('2024-01-02T10:00:00Z'))).toBe(false);
  });

  it('evaluates in the policy tz, not UTC', () => {
    // 09:00..10:00 America/Los_Angeles, Monday.
    const policy = {
      tz: 'America/Los_Angeles',
      windows: [{ days: [1], startMin: 540, endMin: 600 }],
    };
    // 2024-01-01T17:30Z is 09:30 LA on Monday: allowed.
    expect(withinAllowedHours(policy, new Date('2024-01-01T17:30:00Z'))).toBe(true);
    // Same wall-clock interpreted as UTC would NOT be in the LA window;
    // 09:30 UTC = 01:30 LA Monday, which must be denied.
    expect(withinAllowedHours(policy, new Date('2024-01-01T09:30:00Z'))).toBe(false);
  });

  it('setKeyAllowedHours persists the normalised policy and clears with null', async () => {
    const issued = await issueKey(dir, { userId: 'u1', label: 'ci' });
    const updated = await setKeyAllowedHours(dir, 'u1', issued.record.id, {
      tz: 'UTC',
      windows: [{ days: [1, 2, 3, 4, 5], startMin: 540, endMin: 1080 }],
    });
    expect(updated?.allowedHours?.tz).toBe('UTC');
    expect(updated?.allowedHours?.windows[0]!.days).toEqual([1, 2, 3, 4, 5]);
    const all = await loadKeys(dir);
    expect(all[0]!.allowedHours?.windows.length).toBe(1);
    const cleared = await setKeyAllowedHours(dir, 'u1', issued.record.id, null);
    expect(cleared?.allowedHours).toBeNull();
  });

  it('refuses to update a key owned by another user', async () => {
    const issued = await issueKey(dir, { userId: 'u1', label: 'ci' });
    const updated = await setKeyAllowedHours(dir, 'u2', issued.record.id, {
      tz: 'UTC',
      windows: [{ days: [1], startMin: 0, endMin: 1 }],
    });
    expect(updated).toBeNull();
  });

  it('throws on invalid policy so routes can return 400', async () => {
    const issued = await issueKey(dir, { userId: 'u1', label: 'ci' });
    await expect(
      setKeyAllowedHours(dir, 'u1', issued.record.id, {
        tz: 'Not/AZone',
        windows: [{ days: [1], startMin: 0, endMin: 1 }],
      }),
    ).rejects.toThrow();
  });
});
