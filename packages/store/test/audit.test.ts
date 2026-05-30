import { describe, it, expect } from 'vitest';
import { AuditLog } from '../src/audit-log.js';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
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

describe('AuditLog rotation', () => {
  it('rotates the active file once it exceeds maxBytes and keeps the configured number of generations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cm-rot-'));
    const file = join(dir, 'audit.log');
    // Tiny threshold so every write triggers a rotation.
    const log = new AuditLog(file, { maxBytes: 64, keepFiles: 2 });

    await log.write({ actor: 'u', action: 'POST 200', resource: '/v1/one' });
    // After first write, size is well under 64 bytes so no rotation yet.
    let files = await log.listFiles();
    expect(files).toEqual([file]);

    // Pad the file past the threshold and write again to force rotation.
    await writeFile(file, 'x'.repeat(200), 'utf8');
    await log.write({ actor: 'u', action: 'POST 200', resource: '/v1/two' });
    files = await log.listFiles();
    expect(files).toContain(file);
    expect(files).toContain(`${file}.1`);

    // Force two more rotations and confirm retention caps at keepFiles=2.
    await writeFile(file, 'y'.repeat(200), 'utf8');
    await log.write({ actor: 'u', action: 'POST 200', resource: '/v1/three' });
    await writeFile(file, 'z'.repeat(200), 'utf8');
    await log.write({ actor: 'u', action: 'POST 200', resource: '/v1/four' });

    files = await log.listFiles();
    // Active + .1 + .2, no .3
    expect(files.length).toBe(3);
    expect(files[0]).toBe(file);
    expect(files[1]).toBe(`${file}.1`);
    expect(files[2]).toBe(`${file}.2`);
    const past = await stat(`${file}.3`).then(() => true).catch(() => false);
    expect(past).toBe(false);
  });

  it('query reads across rotated siblings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cm-q-'));
    const file = join(dir, 'audit.log');
    const log = new AuditLog(file, { maxBytes: 0, keepFiles: 5 });

    // Seed an event, force a rotation, then write another.
    await log.write({ actor: 'alice', action: 'POST 200', resource: '/v1/a' });
    await log.rotateNow();
    await log.write({ actor: 'alice', action: 'POST 200', resource: '/v1/b' });

    const res = await log.query({ actor: 'alice' });
    expect(res.total).toBe(2);
    const resources = res.events.map((e) => e.resource).sort();
    expect(resources).toEqual(['/v1/a', '/v1/b']);
  });

  it('does not rotate when maxBytes is 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cm-norot-'));
    const file = join(dir, 'audit.log');
    const log = new AuditLog(file, { maxBytes: 0, keepFiles: 5 });
    await writeFile(file, 'x'.repeat(10_000), 'utf8');
    const didRotate = await log.maybeRotate();
    expect(didRotate).toBe(false);
    const files = await log.listFiles();
    expect(files).toEqual([file]);
  });
});
