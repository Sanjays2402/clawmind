import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';
import type { ChatMessage, Source } from '@clawmind/types';

// Conversations are short rolling threads. We keep them as one JSON file per
// conversation so a delete is just an unlink and we never have to compact a
// shared log. The cap on stored turns is the same as the cap we feed back into
// the LLM, so the file size is bounded.

export const MAX_TURNS = 12;        // 6 user + 6 assistant
export const MAX_CONTEXT_TURNS = 6; // turns echoed back into the prompt

export interface ConversationTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  sources?: Source[];
  model?: string;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /**
   * Soft-delete timestamp. Archived conversations stay on disk and remain
   * fetchable by id (so deep links keep working), but are hidden from the
   * default listing endpoint. Use `archived=true` on /v1/conversations to
   * see them. Unarchiving simply clears the field.
   */
  archivedAt?: number;
  turns: ConversationTurn[];
}

function dir(dataDir: string) { return join(dataDir, 'conversations'); }
function file(dataDir: string, id: string) { return join(dir(dataDir), `${id}.json`); }

export async function createConversation(dataDir: string, userId: string, title?: string): Promise<Conversation> {
  const conv: Conversation = {
    id: nanoid(10),
    userId,
    title: title?.slice(0, 120) || 'New conversation',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    turns: [],
  };
  const f = file(dataDir, conv.id);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(conv, null, 2));
  return conv;
}

export async function loadConversation(dataDir: string, id: string): Promise<Conversation | null> {
  try {
    const raw = await readFile(file(dataDir, id), 'utf8');
    return JSON.parse(raw) as Conversation;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function listConversations(
  dataDir: string,
  userId: string,
  opts: { limit?: number; archived?: boolean } = {},
): Promise<Conversation[]> {
  const { limit = 50, archived = false } = opts;
  const d = dir(dataDir);
  try {
    const files = await readdir(d);
    const all = await Promise.all(
      files.filter((n) => n.endsWith('.json')).map(async (n) => {
        const raw = await readFile(join(d, n), 'utf8');
        return JSON.parse(raw) as Conversation;
      }),
    );
    return all
      .filter((c) => c.userId === userId)
      .filter((c) => (archived ? !!c.archivedAt : !c.archivedAt))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Build a short snippet (~140 chars) around the first occurrence of `q`
 * inside `text`, with the match preserved verbatim and ellipses where the
 * surrounding text was clipped. Returns `null` when `q` is not found.
 */
export function snippetAround(text: string, q: string, radius = 60): string | null {
  if (!text || !q) return null;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + q.length + radius);
  const head = start > 0 ? '\u2026' : '';
  const tail = end < text.length ? '\u2026' : '';
  return head + text.slice(start, end).replace(/\s+/g, ' ').trim() + tail;
}

export interface ConversationSearchHit {
  conversation: Conversation;
  snippet: string | null;
  matchedTurn: number | null; // index into turns, or null if title-only match
}

/**
 * Search a user's conversations by free-text. Matches a conversation when
 * `q` (case-insensitive) appears in the title or in any turn's content.
 * Results are sorted by updatedAt desc with title hits ranked above turn
 * hits. Supports `limit` + `offset` for pagination and always returns the
 * unpaged `total` so the UI can render "showing X of Y".
 */
export async function searchConversations(
  dataDir: string,
  userId: string,
  opts: { q?: string; archived?: boolean; limit?: number; offset?: number } = {},
): Promise<{ items: ConversationSearchHit[]; total: number }> {
  const { q = '', archived = false, limit = 50, offset = 0 } = opts;
  const d = dir(dataDir);
  let files: string[] = [];
  try {
    files = await readdir(d);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { items: [], total: 0 };
    throw err;
  }
  const all = await Promise.all(
    files.filter((n) => n.endsWith('.json')).map(async (n) => {
      const raw = await readFile(join(d, n), 'utf8');
      return JSON.parse(raw) as Conversation;
    }),
  );
  const owned = all
    .filter((c) => c.userId === userId)
    .filter((c) => (archived ? !!c.archivedAt : !c.archivedAt));

  const needle = q.trim().toLowerCase();
  type Ranked = ConversationSearchHit & { titleHit: boolean };
  let hits: Ranked[];
  if (!needle) {
    hits = owned.map((c) => ({ conversation: c, snippet: null, matchedTurn: null, titleHit: false }));
  } else {
    hits = [];
    for (const c of owned) {
      const titleHit = c.title.toLowerCase().includes(needle);
      let snippet: string | null = null;
      let matchedTurn: number | null = null;
      for (let i = 0; i < c.turns.length; i++) {
        const turn = c.turns[i];
        if (!turn) continue;
        const s = snippetAround(turn.content, needle);
        if (s) { snippet = s; matchedTurn = i; break; }
      }
      if (titleHit || snippet) {
        hits.push({ conversation: c, snippet, matchedTurn, titleHit });
      }
    }
  }
  hits.sort((a, b) => {
    if (a.titleHit !== b.titleHit) return a.titleHit ? -1 : 1;
    return b.conversation.updatedAt - a.conversation.updatedAt;
  });
  const total = hits.length;
  const page = hits.slice(offset, offset + limit).map(({ titleHit: _t, ...rest }) => rest);
  return { items: page, total };
}

/**
 * Rename a conversation. Returns the updated conversation, or `null` when
 * it does not exist or is not owned by `userId`. The title is trimmed and
 * capped at the same 120-char limit used for fresh conversations.
 */
export async function renameConversation(
  dataDir: string,
  userId: string,
  id: string,
  rawTitle: string,
): Promise<Conversation | null> {
  const conv = await loadConversation(dataDir, id);
  if (!conv || conv.userId !== userId) return null;
  const title = rawTitle.trim().slice(0, 120);
  if (!title) return null;
  conv.title = title;
  conv.updatedAt = Date.now();
  await writeFile(file(dataDir, id), JSON.stringify(conv, null, 2));
  return conv;
}

/**
 * Set or clear the archived flag. Returns the updated conversation, or
 * `null` when it does not exist or is not owned by `userId`. Archiving is
 * idempotent: archiving an already-archived conversation refreshes the
 * timestamp; unarchiving an already-active one is a no-op.
 */
export async function setConversationArchived(
  dataDir: string,
  userId: string,
  id: string,
  archived: boolean,
): Promise<Conversation | null> {
  const conv = await loadConversation(dataDir, id);
  if (!conv || conv.userId !== userId) return null;
  if (archived) conv.archivedAt = Date.now();
  else delete conv.archivedAt;
  await writeFile(file(dataDir, id), JSON.stringify(conv, null, 2));
  return conv;
}

export async function deleteConversation(dataDir: string, userId: string, id: string): Promise<boolean> {
  const conv = await loadConversation(dataDir, id);
  if (!conv || conv.userId !== userId) return false;
  await unlink(file(dataDir, id));
  return true;
}

/**
 * Copy a conversation up to and including the turn at `throughIndex`
 * (0-based, inclusive) into a brand-new conversation owned by `userId`.
 * The new conversation gets fresh turn ids so future appends to either
 * fork do not collide. The original conversation is left untouched.
 *
 * Returns `null` if the source conversation does not exist, is not owned
 * by `userId`, or `throughIndex` is out of range. Returns the new
 * Conversation along with the source's id and the fork point on success.
 */
export async function forkConversation(
  dataDir: string,
  userId: string,
  sourceId: string,
  throughIndex: number,
  title?: string,
): Promise<{ conversation: Conversation; sourceId: string; throughIndex: number } | null> {
  const src = await loadConversation(dataDir, sourceId);
  if (!src || src.userId !== userId) return null;
  if (!Number.isInteger(throughIndex)) return null;
  if (throughIndex < 0 || throughIndex >= src.turns.length) return null;
  const now = Date.now();
  const copied = src.turns.slice(0, throughIndex + 1).map((t) => ({
    ...t,
    id: nanoid(8), // fresh ids so the forks evolve independently
  }));
  const fork: Conversation = {
    id: nanoid(10),
    userId,
    title: (title?.slice(0, 120) || `Fork of: ${src.title}`).slice(0, 120),
    createdAt: now,
    updatedAt: now,
    turns: copied,
  };
  const f = file(dataDir, fork.id);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(fork, null, 2));
  return { conversation: fork, sourceId: src.id, throughIndex };
}

export async function appendTurn(
  dataDir: string,
  id: string,
  turn: Omit<ConversationTurn, 'id' | 'ts'>,
): Promise<Conversation> {
  const conv = await loadConversation(dataDir, id);
  if (!conv) throw new Error(`conversation not found: ${id}`);
  conv.turns.push({ id: nanoid(8), ts: Date.now(), ...turn });
  // Drop the oldest turns once we exceed the cap, preserving the
  // user/assistant pairing by dropping them in pairs from the front.
  while (conv.turns.length > MAX_TURNS) conv.turns.splice(0, 2);
  conv.updatedAt = Date.now();
  if (conv.turns.length === 1 && conv.title === 'New conversation' && turn.role === 'user') {
    conv.title = turn.content.slice(0, 80);
  }
  await writeFile(file(dataDir, id), JSON.stringify(conv, null, 2));
  return conv;
}

export function toChatMessages(conv: Conversation, max = MAX_CONTEXT_TURNS): ChatMessage[] {
  return conv.turns.slice(-max).map((t) => ({ role: t.role, content: t.content }));
}

// Pronoun/reference detector. If a query starts with or relies on a referent
// like "it", "that", "those", "the same", we rewrite the question with the
// most recent user turn prepended so retrieval has enough signal. We never
// rewrite when the query already mentions a content noun at length > 4 chars
// after stopwords, to avoid double-context.
const REFERENT_RE = /\b(it|its|they|them|those|these|that|this|the same|same one|same thing|why|how|what about|and|also|too)\b/i;
const SHORT_THRESHOLD = 6; // words

export function rewriteFollowUp(conv: Conversation, query: string): { rewritten: string; usedHistory: boolean } {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (conv.turns.length === 0) return { rewritten: query, usedHistory: false };
  const lastUser = [...conv.turns].reverse().find((t) => t.role === 'user');
  if (!lastUser) return { rewritten: query, usedHistory: false };
  const needsContext =
    words.length <= SHORT_THRESHOLD ||
    REFERENT_RE.test(query);
  if (!needsContext) return { rewritten: query, usedHistory: false };
  return {
    rewritten: `${lastUser.content.replace(/\s+/g, ' ').trim()} || follow-up: ${query.trim()}`,
    usedHistory: true,
  };
}
