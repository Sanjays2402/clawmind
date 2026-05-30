import { describe, it, expect } from 'vitest';

// Per-route rate-limit settings are inline in the route files; tests here
// guarantee the documented values stay in place so a future edit cannot
// silently widen the budget.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(resolve(here, '..', 'src', p), 'utf8');

describe('rate-limit configuration', () => {
  it('uses a per-user key generator on the global limiter', () => {
    const s = src('server.ts');
    expect(s).toContain('keyGenerator');
    expect(s).toContain("`k:${u.apiKeyId}`");
    expect(s).toContain("`u:${u.id}`");
    expect(s).toContain("`ip:${req.ip}`");
  });

  it('keeps a global ceiling', () => {
    const s = src('server.ts');
    expect(s).toMatch(/max:\s*240/);
    expect(s).toMatch(/timeWindow:\s*'1 minute'/);
  });

  it('caps /v1/ask at 30 per minute', () => {
    const s = src('routes/ask.ts');
    expect(s).toMatch(/rateLimit:\s*\{\s*max:\s*30,\s*timeWindow:\s*'1 minute'/);
  });

  it('caps /v1/ingest at 3 per minute', () => {
    const s = src('routes/ingest.ts');
    expect(s).toMatch(/rateLimit:\s*\{\s*max:\s*3,\s*timeWindow:\s*'1 minute'/);
  });

  it('caps /v1/maintenance/compact at 6 per minute', () => {
    const s = src('routes/maintenance.ts');
    expect(s).toMatch(/rateLimit:\s*\{\s*max:\s*6,\s*timeWindow:\s*'1 minute'/);
  });
});
