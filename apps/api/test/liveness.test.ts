import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { healthRoutes } from '../src/routes/health.js';

// The /live endpoint is the Kubernetes liveness target. It must not call any
// downstream dependency so a flaky embed sidecar or LLM provider cannot
// cascade into pod restarts. It must also remain cheap enough for kubelet to
// hit it every few seconds without measurable overhead.
function build() {
  const app = Fastify();
  // Decorate with the bare minimum the route plugin reads. /live touches none
  // of these, but /health and /ready do; we wire stubs so the plugin registers.
  app.decorate('clawmind', {
    embed: { health: async () => ({ ok: true }) },
    llm: { health: async () => ({ ok: true }) },
    lance: { count: async () => 0 },
    bm25: { size: () => 0 },
    manifest: { size: () => 0 },
  } as never);
  app.register(healthRoutes);
  return app;
}

describe('GET /live', () => {
  it('returns 200 with a tiny payload and no downstream calls', async () => {
    let embedCalls = 0;
    let llmCalls = 0;
    const app = Fastify();
    app.decorate('clawmind', {
      embed: { health: async () => { embedCalls++; return { ok: true }; } },
      llm: { health: async () => { llmCalls++; return { ok: true }; } },
      lance: { count: async () => 0 },
      bm25: { size: () => 0 },
      manifest: { size: () => 0 },
    } as never);
    await app.register(healthRoutes);

    const res = await app.inject({ method: 'GET', url: '/live' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true });
    expect(embedCalls).toBe(0);
    expect(llmCalls).toBe(0);
    await app.close();
  });

  it('responds within a tight budget even if downstream health hangs', async () => {
    const app = Fastify();
    app.decorate('clawmind', {
      // Simulate an embed sidecar that never returns; /live must not await it.
      embed: { health: () => new Promise(() => {}) },
      llm: { health: () => new Promise(() => {}) },
      lance: { count: async () => 0 },
      bm25: { size: () => 0 },
      manifest: { size: () => 0 },
    } as never);
    await app.register(healthRoutes);

    const started = Date.now();
    const res = await app.inject({ method: 'GET', url: '/live' });
    const elapsed = Date.now() - started;
    expect(res.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(250);
    await app.close();
  });

  it('still serves /ready and /health alongside /live', async () => {
    const app = build();
    const live = await app.inject({ method: 'GET', url: '/live' });
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
    expect(health.statusCode).toBe(200);
    await app.close();
  });
});
