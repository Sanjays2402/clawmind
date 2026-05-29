import type { ChatChunk, ChatRequest, LLMProvider } from '@clawmind/types';

export class FallbackLLMProvider implements LLMProvider {
  readonly id: string;
  constructor(private readonly providers: LLMProvider[]) {
    if (providers.length === 0) throw new Error('FallbackLLMProvider requires at least one provider');
    this.id = `fallback(${providers.map((p) => p.id).join(',')})`;
  }
  async health(): Promise<boolean> {
    for (const p of this.providers) if (await p.health()) return true;
    return false;
  }
  async chat(req: ChatRequest): Promise<string> {
    let lastErr: unknown;
    for (const p of this.providers) {
      try { return await p.chat(req); } catch (err) { lastErr = err; }
    }
    throw lastErr instanceof Error ? lastErr : new Error('all LLM providers failed');
  }
  async *stream(req: ChatRequest): AsyncIterable<ChatChunk> {
    let lastErr: unknown;
    for (const p of this.providers) {
      try {
        for await (const c of p.stream(req)) yield c;
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('all LLM providers failed');
  }
}
