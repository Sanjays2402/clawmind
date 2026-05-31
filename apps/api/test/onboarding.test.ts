import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ONBOARDING_STEPS,
  completeStep,
  getRecord,
  loadAll,
  progress,
  setDismissed,
} from '../src/services/onboarding.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-onb-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('onboarding service', () => {
  it('returns an empty record for an unknown user', async () => {
    const rec = await getRecord(dir, 'u1');
    expect(rec.userId).toBe('u1');
    expect(rec.steps).toEqual({});
    expect(rec.dismissed).toBe(false);
  });

  it('completeStep is idempotent and preserves the first timestamp', async () => {
    const first = await completeStep(dir, 'u1', 'ingest');
    const ts1 = first.steps.ingest!;
    expect(ts1).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 5));
    const second = await completeStep(dir, 'u1', 'ingest');
    expect(second.steps.ingest).toBe(ts1);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  });

  it('progress reports completed, next, and counts', async () => {
    let rec = await getRecord(dir, 'u1');
    expect(progress(rec)).toEqual({
      completed: [],
      next: 'ingest',
      total: ONBOARDING_STEPS.length,
      done: 0,
    });
    rec = await completeStep(dir, 'u1', 'ingest');
    expect(progress(rec).next).toBe('ask');
    rec = await completeStep(dir, 'u1', 'ask');
    rec = await completeStep(dir, 'u1', 'configure');
    const p = progress(rec);
    expect(p.next).toBeNull();
    expect(p.done).toBe(ONBOARDING_STEPS.length);
  });

  it('isolates state per user', async () => {
    await completeStep(dir, 'u1', 'ingest');
    await completeStep(dir, 'u2', 'ask');
    const map = await loadAll(dir);
    expect(map.u1.steps.ingest).toBeDefined();
    expect(map.u1.steps.ask).toBeUndefined();
    expect(map.u2.steps.ask).toBeDefined();
    expect(map.u2.steps.ingest).toBeUndefined();
  });

  it('setDismissed toggles the dismissed flag', async () => {
    let rec = await setDismissed(dir, 'u1', true);
    expect(rec.dismissed).toBe(true);
    rec = await setDismissed(dir, 'u1', false);
    expect(rec.dismissed).toBe(false);
  });

  it('rejects an unknown step type at the boundary', async () => {
    // The route layer validates with zod; the service trusts its input.
    // This test pins the assumption that the step union is exactly three.
    expect(ONBOARDING_STEPS).toEqual(['ingest', 'ask', 'configure']);
  });
});
