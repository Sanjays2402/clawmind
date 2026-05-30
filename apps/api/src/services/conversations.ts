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

export async function listConversations(dataDir: string, userId: string, limit = 50): Promise<Conversation[]> {
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
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function deleteConversation(dataDir: string, userId: string, id: string): Promise<boolean> {
  const conv = await loadConversation(dataDir, id);
  if (!conv || conv.userId !== userId) return false;
  await unlink(file(dataDir, id));
  return true;
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
