import { describe, it, expect } from 'vitest';
import { AuditLog } from '../src/audit-log.js';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('AuditLog', () => {
  it('appends jsonl entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cm-'));
    const log = new AuditLog(join(dir, 'audit.log'));
    await log.write({ actor: 'u', action: 'POST 200', resource: '/v1/ask' });
    await log.write({ actor: 'u', action: 'POST 200', resource: '/v1/ask' });
    const raw = await readFile(join(dir, 'audit.log'), 'utf8');
    expect(raw.trim().split('\n').length).toBe(2);
    const first = JSON.parse(raw.trim().split('\n')[0]!);
    expect(first.actor).toBe('u');
    expect(first.id).toBeTypeOf('string');
  });
});
