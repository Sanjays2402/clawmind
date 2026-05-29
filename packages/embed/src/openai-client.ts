import { request } from 'undici';
import type { EmbedProvider, EmbedRequest, EmbedResponse } from '@clawmind/types';

export interface OpenAIClientOptions {
  baseUrl: string;
  model: string;
  dim: number;
  apiKey?: string;
}

export class OpenAIEmbedClient implements EmbedProvider {
  readonly id = 'openai';
  constructor(private readonly opts: OpenAIClientOptions) {}

  dim() { return this.opts.dim; }

  async health(): Promise<boolean> {
    try {
      const { statusCode } = await request(`${this.opts.baseUrl}/models`, {
        method: 'GET',
        headers: this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {},
      });
      return statusCode < 500;
    } catch {
      return false;
    }
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    const res = await request(`${this.opts.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
      },
      body: JSON.stringify({ input: req.texts, model: req.model ?? this.opts.model }),
    });
    if (res.statusCode >= 400) {
      throw new Error(`OpenAI embed ${res.statusCode}`);
    }
    const json = (await res.body.json()) as { data: { embedding: number[] }[]; model: string };
    const vectors = json.data.map((d) => d.embedding);
    return { vectors, model: json.model, dim: vectors[0]?.length ?? this.opts.dim };
  }
}
