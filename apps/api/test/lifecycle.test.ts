import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportUserData, deleteUserData } from '../src/services/lifecycle.js';
import { createConversation, appendTurn } from '../src/services/conversations.js';
import { recordVote } from '../src/services/feedback.js';
import { addSaved } from '../src/services/saved.js';
import { recordHistory } from '../src/services/history.js';
import { issueKey } from '../src/services/api-keys.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-lifecycle-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

async function seed() {
  await recordHistory(dir, {
    id: 'h1', ts: 1, userId: 'alice', query: 'q', answer: 'a', sources: [], model: 'm',
  });
  await recordHistory(dir, {
    id: 'h2', ts: 2, userId: 'bob', query: 'q', answer: 'a', sources: [], model: 'm',
  });
  const c1 = await createConversation(dir, 'alice', 'alice chat');
  await appendTurn(dir, c1.id, { role: 'user', content: 'hello' });
  await createConversation(dir, 'bob', 'bob chat');
  await addSaved(dir, 'alice', { title: 't', query: 'q' });
  await addSaved(dir, 'bob', { title: 't', query: 'q' });
  await recordVote(dir, 'alice', '/x.md', 1);
  await recordVote(dir, 'bob', '/x.md', 1);
  await recordVote(dir, 'alice', '/y.md', -1);
  await issueKey(dir, { userId: 'alice', label: 'cli', role: 'owner' });
  await issueKey(dir, { userId: 'bob', label: 'cli', role: 'owner' });
}

describe('lifecycle.exportUserData', () => {
  it('returns only the requested user records', async () => {
    await seed();
    const out = await exportUserData(dir, 'alice');
    expect(out.schema).toBe('clawmind.user-export.v1');
    expect(out.userId).toBe('alice');
    expect(out.history.map((h) => h.id)).toEqual(['h1']);
    expect(out.conversations).toHaveLength(1);
    expect(out.conversations[0].userId).toBe('alice');
    expect(out.saved).toHaveLength(1);
    expect(out.feedback).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/x.md', vote: 1 }),
      expect.objectContaining({ path: '/y.md', vote: -1 }),
    ]));
    expect(out.feedback).toHaveLength(2);
    expect(out.apiKeys).toHaveLength(1);
    // Hash must not leak in the export bundle.
    expect((out.apiKeys[0] as Record<string, unknown>).hash).toBeUndefined();
  });

  it('returns empty bundle for an unknown user', async () => {
    await seed();
    const out = await exportUserData(dir, 'nobody');
    expect(out.history).toEqual([]);
    expect(out.conversations).toEqual([]);
    expect(out.saved).toEqual([]);
    expect(out.feedback).toEqual([]);
    expect(out.apiKeys).toEqual([]);
  });
});

describe('lifecycle.deleteUserData', () => {
  it('removes per-user data and leaves other users intact', async () => {
    await seed();
    const report = await deleteUserData(dir, 'alice');
    expect(report.removed).toEqual({
      historyItems: 1,
      conversations: 1,
      savedItems: 1,
      feedbackVotes: 2,
      apiKeys: 1,
    });

    // Bob is untouched.
    const bobExport = await exportUserData(dir, 'bob');
    expect(bobExport.history).toHaveLength(1);
    expect(bobExport.conversations).toHaveLength(1);
    expect(bobExport.saved).toHaveLength(1);
    expect(bobExport.feedback).toHaveLength(1);
    expect(bobExport.apiKeys).toHaveLength(1);

    // Alice is empty.
    const aliceExport = await exportUserData(dir, 'alice');
    expect(aliceExport.history).toEqual([]);
    expect(aliceExport.conversations).toEqual([]);
    expect(aliceExport.saved).toEqual([]);
    expect(aliceExport.feedback).toEqual([]);
    expect(aliceExport.apiKeys).toEqual([]);

    // Feedback entry on /x.md (shared with bob) still exists with bob's vote.
    const fb = JSON.parse(await readFile(join(dir, 'feedback.json'), 'utf8'));
    expect(fb['/x.md']).toBeDefined();
    expect(fb['/x.md'].ups).toBe(1);
    expect(fb['/x.md'].byUser).toEqual({ bob: 1 });
    // Entry on /y.md was alice-only and dropped entirely.
    expect(fb['/y.md']).toBeUndefined();
  });

  it('is a no-op for an unknown user', async () => {
    await seed();
    const report = await deleteUserData(dir, 'nobody');
    expect(report.removed).toEqual({
      historyItems: 0,
      conversations: 0,
      savedItems: 0,
      feedbackVotes: 0,
      apiKeys: 0,
    });
  });

  it('handles a fresh dataDir with no files present', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'cm-lifecycle-empty-'));
    try {
      const report = await deleteUserData(empty, 'alice');
      expect(report.removed.historyItems).toBe(0);
      expect(report.removed.conversations).toBe(0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('preserves files for unrelated users (sanity touch test)', async () => {
    // Pre-create a conversations dir with a bob conv and make sure deleteUserData
    // does not blow away the directory itself.
    await mkdir(join(dir, 'conversations'), { recursive: true });
    await writeFile(
      join(dir, 'conversations', 'manual.json'),
      JSON.stringify({
        id: 'manual', userId: 'bob', title: 't',
        createdAt: 1, updatedAt: 1, turns: [],
      }),
    );
    await deleteUserData(dir, 'alice');
    const bobConv = JSON.parse(
      await readFile(join(dir, 'conversations', 'manual.json'), 'utf8'),
    );
    expect(bobConv.userId).toBe('bob');
  });
});
