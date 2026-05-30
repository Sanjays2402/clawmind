import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createConversation, loadConversation, listConversations, deleteConversation,
  forkConversation,
  appendTurn, toChatMessages, rewriteFollowUp, MAX_TURNS, MAX_CONTEXT_TURNS,
  renameConversation, setConversationArchived,
} from '../src/services/conversations.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-conv-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('conversations service', () => {
  it('creates and loads', async () => {
    const c = await createConversation(dir, 'u1', 'Hello there');
    expect(c.id).toBeTruthy();
    expect(c.title).toBe('Hello there');
    const reloaded = await loadConversation(dir, c.id);
    expect(reloaded?.id).toBe(c.id);
  });

  it('defaults title when none provided and replaces with first user turn', async () => {
    const c = await createConversation(dir, 'u1');
    expect(c.title).toBe('New conversation');
    const updated = await appendTurn(dir, c.id, { role: 'user', content: 'what is snip and why does it matter' });
    expect(updated.title).toBe('what is snip and why does it matter');
  });

  it('caps stored turns at MAX_TURNS', async () => {
    const c = await createConversation(dir, 'u1');
    for (let i = 0; i < MAX_TURNS + 4; i++) {
      await appendTurn(dir, c.id, { role: i % 2 === 0 ? 'user' : 'assistant', content: `turn ${i}` });
    }
    const reloaded = await loadConversation(dir, c.id);
    expect(reloaded!.turns.length).toBeLessThanOrEqual(MAX_TURNS);
  });

  it('lists in updatedAt desc and filters by user', async () => {
    const a = await createConversation(dir, 'u1', 'A');
    await new Promise((r) => setTimeout(r, 5));
    const b = await createConversation(dir, 'u1', 'B');
    await createConversation(dir, 'u2', 'other');
    await new Promise((r) => setTimeout(r, 5));
    await appendTurn(dir, a.id, { role: 'user', content: 'touch a later' });
    const list = await listConversations(dir, 'u1');
    expect(list.map((c) => c.id)).toEqual([a.id, b.id]);
  });

  it('returns empty list when no conversations exist', async () => {
    const list = await listConversations(dir, 'nobody');
    expect(list).toEqual([]);
  });

  it('deletes only when owned by user', async () => {
    const c = await createConversation(dir, 'u1');
    const wrong = await deleteConversation(dir, 'u2', c.id);
    expect(wrong).toBe(false);
    const right = await deleteConversation(dir, 'u1', c.id);
    expect(right).toBe(true);
    expect(await loadConversation(dir, c.id)).toBeNull();
  });

  it('toChatMessages returns at most MAX_CONTEXT_TURNS', async () => {
    const c = await createConversation(dir, 'u1');
    for (let i = 0; i < 20; i++) {
      await appendTurn(dir, c.id, { role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` });
    }
    const conv = (await loadConversation(dir, c.id))!;
    expect(toChatMessages(conv).length).toBeLessThanOrEqual(MAX_CONTEXT_TURNS);
  });

  it('appendTurn throws when conversation is missing', async () => {
    await expect(appendTurn(dir, 'nope', { role: 'user', content: 'hi' })).rejects.toThrow();
  });
});

describe('rewriteFollowUp', () => {
  const conv = (turns: { role: 'user' | 'assistant'; content: string }[]) => ({
    id: 'x', userId: 'u', title: 't', createdAt: 0, updatedAt: 0,
    turns: turns.map((t, i) => ({ id: `t${i}`, ts: i, ...t })),
  });

  it('passes through long, self-contained queries', () => {
    const c = conv([{ role: 'user', content: 'tell me about snip the screenshot tool' }]);
    const r = rewriteFollowUp(c as never, 'what release notes did we ship for snip launch v2 last month');
    expect(r.usedHistory).toBe(false);
  });

  it('rewrites short follow-ups', () => {
    const c = conv([{ role: 'user', content: 'what is snip' }, { role: 'assistant', content: 'a tool' }]);
    const r = rewriteFollowUp(c as never, 'why');
    expect(r.usedHistory).toBe(true);
    expect(r.rewritten).toContain('what is snip');
    expect(r.rewritten).toContain('why');
  });

  it('rewrites queries with explicit referents like "that"', () => {
    const c = conv([{ role: 'user', content: 'show me the lance store wrapper code' }]);
    const r = rewriteFollowUp(c as never, 'and what about the bm25 side of that');
    expect(r.usedHistory).toBe(true);
  });

  it('no-ops on empty history', () => {
    const r = rewriteFollowUp(conv([]) as never, 'why');
    expect(r.usedHistory).toBe(false);
    expect(r.rewritten).toBe('why');
  });
});

describe('forkConversation', () => {
  async function seed(userId: string) {
    const c = await createConversation(dir, userId, 'Original');
    await appendTurn(dir, c.id, { role: 'user', content: 'q1' });
    await appendTurn(dir, c.id, { role: 'assistant', content: 'a1' });
    await appendTurn(dir, c.id, { role: 'user', content: 'q2' });
    await appendTurn(dir, c.id, { role: 'assistant', content: 'a2' });
    return (await loadConversation(dir, c.id))!;
  }

  it('copies turns through the fork point and assigns a new id', async () => {
    const src = await seed('u1');
    const out = await forkConversation(dir, 'u1', src.id, 1);
    expect(out).not.toBeNull();
    expect(out!.conversation.id).not.toBe(src.id);
    expect(out!.conversation.turns).toHaveLength(2);
    expect(out!.conversation.turns.map((t) => t.content)).toEqual(['q1', 'a1']);
  });

  it('gives every copied turn a fresh id so forks evolve independently', async () => {
    const src = await seed('u1');
    const out = (await forkConversation(dir, 'u1', src.id, src.turns.length - 1))!;
    const srcIds = new Set(src.turns.map((t) => t.id));
    for (const t of out.conversation.turns) {
      expect(srcIds.has(t.id)).toBe(false);
    }
  });

  it('leaves the source conversation untouched', async () => {
    const src = await seed('u1');
    await forkConversation(dir, 'u1', src.id, 1);
    const reloaded = await loadConversation(dir, src.id);
    expect(reloaded!.turns.map((t) => t.content)).toEqual(['q1', 'a1', 'q2', 'a2']);
  });

  it('uses a provided title or falls back to "Fork of: <source>"', async () => {
    const src = await seed('u1');
    const a = (await forkConversation(dir, 'u1', src.id, 0))!;
    expect(a.conversation.title).toBe('Fork of: Original');
    const b = (await forkConversation(dir, 'u1', src.id, 0, 'My branch'))!;
    expect(b.conversation.title).toBe('My branch');
  });

  it('returns null when the source does not exist', async () => {
    expect(await forkConversation(dir, 'u1', 'nope', 0)).toBeNull();
  });

  it('returns null when another user owns the source', async () => {
    const src = await seed('u1');
    expect(await forkConversation(dir, 'u2', src.id, 0)).toBeNull();
  });

  it('returns null on an out-of-range index', async () => {
    const src = await seed('u1');
    expect(await forkConversation(dir, 'u1', src.id, -1)).toBeNull();
    expect(await forkConversation(dir, 'u1', src.id, src.turns.length)).toBeNull();
  });

  it('the fork shows up in listConversations alongside the source', async () => {
    const src = await seed('u1');
    const out = (await forkConversation(dir, 'u1', src.id, 1))!;
    const list = await listConversations(dir, 'u1');
    const ids = list.map((c) => c.id);
    expect(ids).toContain(src.id);
    expect(ids).toContain(out.conversation.id);
  });
});

describe('renameConversation', () => {
  it('updates the title and bumps updatedAt', async () => {
    const c = await createConversation(dir, 'u1', 'old');
    await new Promise((r) => setTimeout(r, 2));
    const out = (await renameConversation(dir, 'u1', c.id, '  fresh title  '))!;
    expect(out.title).toBe('fresh title');
    expect(out.updatedAt).toBeGreaterThan(c.updatedAt);
    const reloaded = await loadConversation(dir, c.id);
    expect(reloaded!.title).toBe('fresh title');
  });

  it('caps overlong titles at 120 chars', async () => {
    const c = await createConversation(dir, 'u1', 'old');
    const huge = 'x'.repeat(500);
    const out = (await renameConversation(dir, 'u1', c.id, huge))!;
    expect(out.title.length).toBe(120);
  });

  it('returns null on whitespace-only titles', async () => {
    const c = await createConversation(dir, 'u1', 'old');
    expect(await renameConversation(dir, 'u1', c.id, '   ')).toBeNull();
  });

  it('refuses to rename a conversation owned by someone else', async () => {
    const c = await createConversation(dir, 'u1', 'old');
    expect(await renameConversation(dir, 'u2', c.id, 'hack')).toBeNull();
    expect((await loadConversation(dir, c.id))!.title).toBe('old');
  });

  it('returns null on a missing conversation', async () => {
    expect(await renameConversation(dir, 'u1', 'does-not-exist', 'x')).toBeNull();
  });
});

describe('setConversationArchived', () => {
  it('archives, hides from default listing, but stays loadable by id', async () => {
    const c = await createConversation(dir, 'u1', 'doomed');
    const out = (await setConversationArchived(dir, 'u1', c.id, true))!;
    expect(out.archivedAt).toBeTypeOf('number');
    expect((await listConversations(dir, 'u1')).map((x) => x.id)).not.toContain(c.id);
    expect((await loadConversation(dir, c.id))!.archivedAt).toBeTypeOf('number');
  });

  it('archived listing returns archived items', async () => {
    const a = await createConversation(dir, 'u1', 'a');
    const b = await createConversation(dir, 'u1', 'b');
    await setConversationArchived(dir, 'u1', a.id, true);
    const archived = await listConversations(dir, 'u1', { archived: true });
    const active = await listConversations(dir, 'u1');
    expect(archived.map((x) => x.id)).toEqual([a.id]);
    expect(active.map((x) => x.id)).toEqual([b.id]);
  });

  it('unarchiving restores visibility', async () => {
    const c = await createConversation(dir, 'u1', 'x');
    await setConversationArchived(dir, 'u1', c.id, true);
    const out = (await setConversationArchived(dir, 'u1', c.id, false))!;
    expect(out.archivedAt).toBeUndefined();
    expect((await listConversations(dir, 'u1')).map((x) => x.id)).toContain(c.id);
  });

  it('refuses cross-user archive', async () => {
    const c = await createConversation(dir, 'u1', 'x');
    expect(await setConversationArchived(dir, 'u2', c.id, true)).toBeNull();
    expect((await loadConversation(dir, c.id))!.archivedAt).toBeUndefined();
  });

  it('returns null on a missing conversation', async () => {
    expect(await setConversationArchived(dir, 'u1', 'nope', true)).toBeNull();
  });
});
