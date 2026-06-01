import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Resolve the workflow relative to the repo root (apps/api -> ../../.github).
const workflowPath = resolve(__dirname, '..', '..', '..', '.github', 'workflows', 'ci.yml');

function loadWorkflow(): string {
  expect(existsSync(workflowPath), `ci.yml missing at ${workflowPath}`).toBe(true);
  return readFileSync(workflowPath, 'utf8');
}

describe('ci workflow shape', () => {
  const wf = loadWorkflow();

  it('declares the hardening jobs', () => {
    for (const name of ['guard:', 'verify:', 'audit:', 'secrets:', 'docker:']) {
      expect(wf).toContain(name);
    }
  });

  it('every executable job gates on the billing guard output', () => {
    const gateLine = "needs.guard.outputs.enabled == 'true'";
    // 4 gated jobs: verify, audit, secrets, docker. Count occurrences.
    const count = wf.split(gateLine).length - 1;
    expect(count).toBe(4);
  });

  it('verify job runs install, typecheck, test, and build', () => {
    for (const cmd of [
      'pnpm install --frozen-lockfile',
      'pnpm typecheck',
      'pnpm test',
      'pnpm build',
    ]) {
      expect(wf).toContain(cmd);
    }
  });

  it('audit job runs pnpm audit at high severity or above', () => {
    expect(wf).toMatch(/pnpm audit[^\n]*--audit-level\s+high/);
  });

  it('docker job builds all three production images via build-push-action', () => {
    expect(wf).toContain('docker/build-push-action');
    for (const f of [
      'infra/docker/api.Dockerfile',
      'infra/docker/web.Dockerfile',
      'infra/docker/embed.Dockerfile',
    ]) {
      expect(wf).toContain(f);
      expect(existsSync(resolve(__dirname, '..', '..', '..', f))).toBe(true);
    }
  });
});
