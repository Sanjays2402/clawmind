import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDryRun, auditAction, DRY_RUN_AUDIT_SUFFIX } from '../src/lib/dry-run.js';
import {
  previewUserDataDeletion,
  exportUserData,
  deleteUserData,
} from '../src/services/lifecycle.js';
import { previewPruneHistory, pruneHistory } from '../src/services/history.js';
import { recordHistory } from '../src/services/history.js';
import { addSaved } from '../src/services/saved.js';
import { recordVote } from '../src/services/feedback.js';
import { issueKey } from '../src/services/api-keys.js';
import { createConversation } from '../src/services/conversations.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-dryrun-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('dry-run query parsing', () => {
  it('accepts true / 1 / yes case-insensitively', () => {
    expect(isDryRun('true')).toBe(true);
    expect(isDryRun('TRUE')).toBe(true);
    expect(isDryRun('1')).toBe(true);
    expect(isDryRun('yes')).toBe(true);
    expect(isDryRun('  Yes  ')).toBe(true);
  });

  it('rejects everything else (including "false" and arbitrary strings)', () => {
    expect(isDryRun('false')).toBe(false);
    expect(isDryRun('0')).toBe(false);
    expect(isDryRun('')).toBe(false);
    expect(isDryRun(undefined)).toBe(false);
    expect(isDryRun(null)).toBe(false);
    expect(isDryRun('please')).toBe(false);
  });

  it('audit action gets the .dry_run suffix only in preview mode', () => {
    expect(auditAction('history.prune', false)).toBe('history.prune');
    expect(auditAction('history.prune', true)).toBe('history.prune.dry_run');
    expect(DRY_RUN_AUDIT_SUFFIX).toBe('.dry_run');
  });
});

async function seed() {
  await recordHistory(dir, {
    id: 'h1', ts: 1, userId: 'alice', query: 'q', answer: 'a', sources: [], model: 'm',
  });
  await recordHistory(dir, {
    id: 'h2', ts: 2, userId: 'alice', query: 'q', answer: 'a', sources: [], model: 'm',
  });
  await recordHistory(dir, {
    id: 'h3', ts: 3, userId: 'bob', query: 'q', answer: 'a', sources: [], model: 'm',
  });
  await createConversation(dir, 'alice', 'alice chat');
  await addSaved(dir, 'alice', { title: 't', query: 'q' });
  await recordVote(dir, 'alice', '/x.md', 1);
  await issueKey(dir, { userId: 'alice', label: 'cli', role: 'owner' });
}

describe('previewUserDataDeletion', () => {
  it('counts exactly what deleteUserData would remove without mutating', async () => {
    await seed();
    const preview = await previewUserDataDeletion(dir, 'alice');
    expect(preview.schema).toBe('clawmind.user-deletion-preview.v1');
    expect(preview.dryRun).toBe(true);
    expect(preview.wouldRemove).toEqual({
      historyItems: 2,
      conversations: 1,
      savedItems: 1,
      feedbackVotes: 1,
      apiKeys: 1,
    });

    // Critically: alice's data is still intact after the preview.
    const stillThere = await exportUserData(dir, 'alice');
    expect(stillThere.history).toHaveLength(2);
    expect(stillThere.conversations).toHaveLength(1);
    expect(stillThere.saved).toHaveLength(1);
    expect(stillThere.feedback).toHaveLength(1);
    expect(stillThere.apiKeys).toHaveLength(1);
  });

  it('matches the real deletion report exactly when followed by deleteUserData', async () => {
    await seed();
    const preview = await previewUserDataDeletion(dir, 'alice');
    const real = await deleteUserData(dir, 'alice');
    expect(real.removed).toEqual(preview.wouldRemove);
  });
});

describe('previewPruneHistory', () => {
  it('reports same counts as pruneHistory but leaves history.jsonl untouched', async () => {
    await seed();
    const preview = await previewPruneHistory(dir, 'alice', { keepPerUser: 1 });
    expect(preview).toEqual({ removed: 1, kept: 1 });

    // Confirm nothing was written: a second preview still sees both rows.
    const again = await previewPruneHistory(dir, 'alice', { keepPerUser: 1 });
    expect(again).toEqual({ removed: 1, kept: 1 });

    // Real prune now executes and reports the same.
    const real = await pruneHistory(dir, 'alice', { keepPerUser: 1 });
    expect(real).toEqual({ removed: 1, kept: 1 });
  });
});
