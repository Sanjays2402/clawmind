import { request } from 'undici';
import { createParser } from 'eventsource-parser';
import type { ChatChunk, ChatRequest, LLMProvider } from '@clawmind/types';

export interface OpenAICompatOptions {
  id: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  constructor(private readonly opts: OpenAICompatOptions) {
    this.id = opts.id;
  }

  async health(): Promise<boolean> {
    try {
      const { statusCode } = await request(`${this.opts.baseUrl}/models`, {
        method: 'GET',
        headers: this.headers(),
      });
      return statusCode < 500;
    } catch {
      return false;
    }
  }

  private headers() {
    return {
      'content-type': 'application/json',
      ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
    };
  }

  async chat(req: ChatRequest): Promise<string> {
    const res = await request(`${this.opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: req.model || this.opts.defaultModel,
        messages: req.messages,
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxTokens ?? 1024,
        stream: false,
      }),
    });
    if (res.statusCode >= 400) {
      const body = await res.body.text();
      throw new Error(`${this.id} chat ${res.statusCode}: ${body.slice(0, 200)}`);
    }
    const json = (await res.body.json()) as { choices: { message: { content: string } }[] };
    return json.choices[0]?.message.content ?? '';
  }

  async *stream(req: ChatRequest): AsyncIterable<ChatChunk> {
    const res = await request(`${this.opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: req.model || this.opts.defaultModel,
        messages: req.messages,
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxTokens ?? 1024,
        stream: true,
      }),
    });
    if (res.statusCode >= 400) {
      const body = await res.body.text();
      throw new Error(`${this.id} stream ${res.statusCode}: ${body.slice(0, 200)}`);
    }

    const queue: ChatChunk[] = [];
    let resolveWait: (() => void) | null = null;
    let finished = false;

    const parser = createParser({
      onEvent: (evt) => {
        const data = evt.data;
        if (!data) return;
        if (data === '[DONE]') {
          queue.push({ delta: '', done: true });
          finished = true;
          resolveWait?.();
          return;
        }
        try {
          const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
          const delta = parsed.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            queue.push({ delta, done: false });
            resolveWait?.();
          }
        } catch {
          /* ignore malformed lines */
        }
      },
    });

    const reader = res.body;
    (async () => {
      for await (const chunk of reader) {
        parser.feed(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      }
      finished = true;
      queue.push({ delta: '', done: true });
      resolveWait?.();
    })().catch((err) => {
      queue.push({ delta: `\n[stream error: ${(err as Error).message}]`, done: true });
      finished = true;
      resolveWait?.();
    });

    while (true) {
      if (queue.length === 0) {
        if (finished) return;
        await new Promise<void>((r) => (resolveWait = r));
        resolveWait = null;
      }
      while (queue.length) {
        const item = queue.shift()!;
        yield item;
        if (item.done) return;
      }
    }
  }
}
