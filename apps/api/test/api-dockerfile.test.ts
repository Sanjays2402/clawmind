import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The API Dockerfile is the deployable surface that hits prod. These tests
// freeze the properties we care about: real multi-stage isolation, non-root
// runtime, prod-only deps, no source tree leaking into the final image,
// PID 1 init, and a working healthcheck. Plain text assertions keep this
// runnable in CI without a docker daemon, matching helm-chart.test.ts style.
const dockerfilePath = resolve(__dirname, '..', '..', '..', 'infra', 'docker', 'api.Dockerfile');
const dockerfile = readFileSync(dockerfilePath, 'utf8');

describe('api Dockerfile production hardening', () => {
  it('uses a node:20 alpine base for build and runtime', () => {
    expect(dockerfile).toMatch(/FROM node:20-alpine AS base/);
    expect(dockerfile).toMatch(/FROM node:20-alpine AS runtime/);
  });

  it('declares all required pipeline stages', () => {
    for (const stage of ['base', 'deps', 'build', 'prod', 'deploy', 'runtime']) {
      expect(dockerfile).toMatch(new RegExp(`AS ${stage}\\b`));
    }
  });

  it('uses pnpm deploy to produce a self-contained app bundle', () => {
    expect(dockerfile).toMatch(/pnpm --filter @clawmind\/api deploy --prod[^\n]*\/out/);
  });

  it('installs production-only deps before deploying', () => {
    expect(dockerfile).toMatch(/pnpm[^\n]*install --prod[^\n]*--frozen-lockfile/);
  });

  it('runtime image only copies built artefacts, not repo source', () => {
    const runtimeBlock = dockerfile.split(/^FROM .*AS runtime\b/m)[1] ?? '';
    expect(runtimeBlock).toBeTruthy();
    // Whitelist the only paths the runtime stage is allowed to pull in.
    const copyTargets = [...runtimeBlock.matchAll(/COPY --from=deploy[^\n]*\s(\.\/[\w./-]+)/g)].map(
      (m) => m[1],
    );
    expect(copyTargets.sort()).toEqual(['./dist', './node_modules', './package.json'].sort());
    // Source tree, tsconfig, turbo, lockfile, pnpm itself must not appear.
    expect(runtimeBlock).not.toMatch(/COPY[^\n]*\/repo/);
    expect(runtimeBlock).not.toMatch(/\bsrc\b/);
    expect(runtimeBlock).not.toMatch(/tsconfig/);
    expect(runtimeBlock).not.toMatch(/pnpm-lock/);
    expect(runtimeBlock).not.toMatch(/corepack/);
  });

  it('runs as a non-root user with a fixed uid', () => {
    expect(dockerfile).toMatch(/adduser -D -u 10001/);
    expect(dockerfile).toMatch(/^USER cm$/m);
  });

  it('uses tini as PID 1 to reap zombies and forward signals', () => {
    expect(dockerfile).toMatch(/apk add[^\n]*\btini\b/);
    expect(dockerfile).toMatch(/ENTRYPOINT \["\/sbin\/tini", "--"\]/);
  });

  it('exposes a container HEALTHCHECK against /live', () => {
    expect(dockerfile).toMatch(/HEALTHCHECK[^\n]*\n[^\n]*\/live/);
  });

  it('runtime entrypoint runs the compiled dist, not tsx or source', () => {
    expect(dockerfile).toMatch(/CMD \["node", "dist\/server\.js"\]/);
    expect(dockerfile).not.toMatch(/CMD[^\n]*tsx/);
    expect(dockerfile).not.toMatch(/CMD[^\n]*src\//);
  });

  it('sets NODE_ENV=production and binds to 0.0.0.0 in the image', () => {
    expect(dockerfile).toMatch(/ENV[^\n]*NODE_ENV=production/);
    expect(dockerfile).toMatch(/CLAWMIND_API_HOST=0\.0\.0\.0/);
  });
});
