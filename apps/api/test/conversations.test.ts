import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createConversation, loadConversation, listConversations, deleteConversation,
  appendTurn, toChatMessages, rewriteFollowUp, MAX_TURNS, MAX_CONTEXT_TURNS,
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
