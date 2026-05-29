import { request } from 'undici';
import pRetry from 'p-retry';
import type { EmbedProvider, EmbedRequest, EmbedResponse } from '@clawmind/types';

export interface MlxClientOptions {
  baseUrl: string;
  model: string;
  dim: number;
  timeoutMs?: number;
}

export class MlxEmbedClient implements EmbedProvider {
  readonly id = 'mlx';
  constructor(private readonly opts: MlxClientOptions) {}

  dim(): number {
    return this.opts.dim;
  }

  async health(): Promise<boolean> {
    try {
      const { statusCode } = await request(`${this.opts.baseUrl}/health`, { method: 'GET' });
      return statusCode === 200;
    } catch {
      return false;
    }
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    return pRetry(
      async () => {
        const res = await request(`${this.opts.baseUrl}/embed`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ texts: req.texts, model: req.model ?? this.opts.model }),
          bodyTimeout: this.opts.timeoutMs ?? 60_000,
        });
        if (res.statusCode >= 400) {
          throw new Error(`MLX embed ${res.statusCode}`);
        }
        const json = (await res.body.json()) as { vectors: number[][]; model: string; dim: number };
        return json;
      },
      { retries: 2, minTimeout: 200 },
    );
  }
}
