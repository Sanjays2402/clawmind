import type { EmbedProvider, EmbedRequest, EmbedResponse } from '@clawmind/types';

export class FallbackEmbedProvider implements EmbedProvider {
  readonly id: string;
  constructor(private readonly providers: EmbedProvider[]) {
    if (providers.length === 0) throw new Error('FallbackEmbedProvider requires at least one provider');
    this.id = `fallback(${providers.map((p) => p.id).join(',')})`;
  }

  dim(): number {
    return this.providers[0]!.dim();
  }

  async health(): Promise<boolean> {
    for (const p of this.providers) if (await p.health()) return true;
    return false;
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    let lastErr: unknown;
    for (const p of this.providers) {
      try {
        return await p.embed(req);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('all embed providers failed');
  }
}
