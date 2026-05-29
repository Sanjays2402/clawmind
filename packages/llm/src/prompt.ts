import type { ChatMessage } from '@clawmind/types';

export const SYSTEM_PROMPT = `You are ClawMind, a careful assistant grounded in the user's own notes and code.
Rules:
- Use only the provided context. If the answer is not there, say so.
- Cite every nontrivial claim with inline markers like [^1], [^2] that map to the listed sources.
- Be concise. Prefer specifics over generalities.
- Never invent file paths, dates, or commit hashes.`;

export interface BuildPromptInput {
  question: string;
  context: { n: number; path: string; lines: string; excerpt: string }[];
  conversation?: ChatMessage[];
}

export function buildPrompt(input: BuildPromptInput): ChatMessage[] {
  const contextBlock = input.context
    .map((c) => `[^${c.n}] ${c.path}:${c.lines}\n${c.excerpt}`)
    .join('\n\n');
  const sys: ChatMessage = { role: 'system', content: SYSTEM_PROMPT };
  const user: ChatMessage = {
    role: 'user',
    content: `Context:\n${contextBlock}\n\nQuestion:\n${input.question}\n\nAnswer with inline citations like [^1].`,
  };
  return [sys, ...(input.conversation ?? []), user];
}
