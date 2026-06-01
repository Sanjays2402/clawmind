import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getPolicy,
  setMode,
  addRule,
  removeRule,
  evaluate,
  AllowlistValidationError,
  MAX_MODELS,
} from '../src/services/model-allowlist.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-model-allow-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('model-allowlist service', () => {
  it('starts disabled with no models', async () => {
    const p = await getPolicy(dir);
    expect(p.mode).toBe('disabled');
    expect(p.models).toEqual([]);
  });

  it('disabled mode allows any model', () => {
    expect(
      evaluate({ version: 1, mode: 'disabled', models: [], updatedBy: null, updatedAt: 0 }, 'anything').allowed,
    ).toBe(true);
  });

  it('persists mode changes and rejects unknown modes', async () => {
    const p = await setMode(dir, 'u-owner', { mode: 'allow' });
    expect(p.mode).toBe('allow');
    expect(p.updatedBy).toBe('u-owner');
    await expect(
      setMode(dir, 'u-owner', { mode: 'sneaky' as never }),
    ).rejects.toBeInstanceOf(AllowlistValidationError);
  });

  it('rejects empty model id and duplicates (case-insensitive)', async () => {
    await expect(addRule(dir, 'u', { model: '   ' })).rejects.toBeInstanceOf(AllowlistValidationError);
    await addRule(dir, 'u', { model: 'gpt-4o-mini' });
    await expect(addRule(dir, 'u', { model: 'GPT-4O-MINI' })).rejects.toBeInstanceOf(
      AllowlistValidationError,
    );
  });

  it('removes a rule by id', async () => {
    const r = await addRule(dir, 'u', { model: 'claude-3-7-sonnet', label: 'prod' });
    const removed = await removeRule(dir, r.id);
    expect(removed?.id).toBe(r.id);
    expect(await removeRule(dir, 'nope')).toBe(null);
  });

  it('caps total models', async () => {
    for (let i = 0; i < MAX_MODELS; i++) {
      await addRule(dir, 'u', { model: `m-${i}` });
    }
    await expect(addRule(dir, 'u', { model: 'overflow' })).rejects.toBeInstanceOf(
      AllowlistValidationError,
    );
  });

  describe('evaluate', () => {
    it('allow mode permits only listed models', async () => {
      await setMode(dir, 'u', { mode: 'allow' });
      await addRule(dir, 'u', { model: 'gpt-4o-mini' });
      const p = await getPolicy(dir);
      expect(evaluate(p, 'gpt-4o-mini').allowed).toBe(true);
      expect(evaluate(p, 'GPT-4O-MINI').allowed).toBe(true); // case-insensitive
      expect(evaluate(p, 'claude-3').allowed).toBe(false);
    });

    it('block mode permits everything except listed models', async () => {
      await setMode(dir, 'u', { mode: 'block' });
      await addRule(dir, 'u', { model: 'shadow-model' });
      const p = await getPolicy(dir);
      expect(evaluate(p, 'shadow-model').allowed).toBe(false);
      expect(evaluate(p, 'shadow-model').matched?.model).toBe('shadow-model');
      expect(evaluate(p, 'gpt-4o-mini').allowed).toBe(true);
    });

    it('allow mode with empty list denies every request (fail-closed)', async () => {
      await setMode(dir, 'u', { mode: 'allow' });
      const p = await getPolicy(dir);
      expect(evaluate(p, 'anything').allowed).toBe(false);
    });
  });
});
