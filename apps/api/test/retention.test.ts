import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getPolicy,
  updatePolicy,
  applyPolicy,
  validatePatch,
  RetentionValidationError,
  RETENTION_LIMITS,
} from '../src/services/retention.js';
import { recordHistory, listHistory } from '../src/services/history.js';
import { createConversation, listConversations } from '../src/services/conversations.js';
import { readFileSync, writeFileSync } from 'node:fs';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-retention-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('retention service', () => {
  it('defaults to "keep forever" on first read and does not write', async () => {
    const p = await getPolicy(dir, 'alice');
    expect(p.historyDays).toBeNull();
    expect(p.conversationDays).toBeNull();
    expect(p.auditDays).toBeNull();
    expect(p.lastSweepAt).toBeNull();
  });

  it('rejects out-of-range and non-integer values', () => {
    expect(() => validatePatch({ historyDays: 0 })).toThrow(RetentionValidationError);
    expect(() => validatePatch({ historyDays: RETENTION_LIMITS.maxDays + 1 })).toThrow(
      RetentionValidationError,
    );
    expect(() => validatePatch({ conversationDays: 1.5 as unknown as number })).toThrow(
      RetentionValidationError,
    );
    // valid values pass
    validatePatch({ historyDays: 30, conversationDays: 365, auditDays: null });
  });

  it('isolates policies per user', async () => {
    await updatePolicy(dir, 'alice', { historyDays: 7 });
    await updatePolicy(dir, 'bob', { historyDays: 30 });
    expect((await getPolicy(dir, 'alice')).historyDays).toBe(7);
    expect((await getPolicy(dir, 'bob')).historyDays).toBe(30);
  });

  it('applies the policy and removes only entries older than the window for the caller', async () => {
    const now = Date.UTC(2026, 4, 31);
    const day = 24 * 60 * 60 * 1000;

    await recordHistory(dir, {
      id: 'h-old-alice',
      ts: now - 60 * day,
      userId: 'alice',
      query: 'old',
      answer: 'a',
      model: 'm',
      sources: [],
    });
    await recordHistory(dir, {
      id: 'h-new-alice',
      ts: now - 2 * day,
      userId: 'alice',
      query: 'new',
      answer: 'a',
      model: 'm',
      sources: [],
    });
    await recordHistory(dir, {
      id: 'h-old-bob',
      ts: now - 60 * day,
      userId: 'bob',
      query: 'old bob',
      answer: 'a',
      model: 'm',
      sources: [],
    });

    await updatePolicy(dir, 'alice', { historyDays: 30 });
    const dry = await applyPolicy(dir, 'alice', { dryRun: true, now });
    expect(dry.history.removed).toBe(1);
    expect(dry.history.kept).toBe(1);
    // dry run does not mutate
    expect((await listHistory(dir, 'alice')).length).toBe(2);

    const real = await applyPolicy(dir, 'alice', { now });
    expect(real.history.removed).toBe(1);
    const remaining = await listHistory(dir, 'alice');
    expect(remaining.map((i) => i.id)).toEqual(['h-new-alice']);

    // bob's data is untouched: cross-user isolation
    const bob = await listHistory(dir, 'bob');
    expect(bob.map((i) => i.id)).toEqual(['h-old-bob']);

    const after = await getPolicy(dir, 'alice');
    expect(after.lastSweepAt).toBe(now);
  });

  it('sweeps stale conversations by updatedAt and leaves fresh ones alone', async () => {
    const now = Date.UTC(2026, 4, 31);
    const day = 24 * 60 * 60 * 1000;

    const fresh = await createConversation(dir, 'alice', 'fresh');
    const stale = await createConversation(dir, 'alice', 'stale');

    // Hand-edit the stale conversation's updatedAt to be 200 days ago.
    const stalePath = join(dir, 'conversations', `${stale.id}.json`);
    const conv = JSON.parse(readFileSync(stalePath, 'utf8'));
    conv.updatedAt = now - 200 * day;
    conv.createdAt = now - 200 * day;
    writeFileSync(stalePath, JSON.stringify(conv, null, 2));

    await updatePolicy(dir, 'alice', { conversationDays: 90 });
    const report = await applyPolicy(dir, 'alice', { now });
    expect(report.conversations.removed).toBe(1);
    expect(report.conversations.removedIds).toEqual([stale.id]);

    const surviving = await listConversations(dir, 'alice', { archived: undefined });
    expect(surviving.map((c) => c.id)).toEqual([fresh.id]);
  });
});
