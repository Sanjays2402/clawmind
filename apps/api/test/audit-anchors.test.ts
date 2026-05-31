import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuditLog,
  AuditAnchorStore,
  verifyAnchorSignature,
} from '@clawmind/store';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-audit-anchors-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

const SECRET = 'a-test-secret-32-bytes-of-key-material!';

describe('AuditAnchorStore', () => {
  it('records and validates HMAC-signed anchors', async () => {
    const store = new AuditAnchorStore(join(dir, 'anchors.jsonl'), SECRET);
    const a = await store.record({
      headHash: 'deadbeef',
      checked: 7,
      note: 'monthly close',
    });
    expect(a.id).toBeTruthy();
    expect(a.hmac).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyAnchorSignature(a, SECRET)).toBe(true);
    expect(verifyAnchorSignature(a, 'other-secret')).toBe(false);
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.signatureValid).toBe(true);
  });

  it('verifyLatest reports ok when the chain still matches', async () => {
    const log = new AuditLog(join(dir, 'audit.log'));
    await log.write({ actor: 'u', action: 'a', resource: '/x' });
    await log.write({ actor: 'u', action: 'b', resource: '/y' });
    const v = await log.verify();
    const store = new AuditAnchorStore(join(dir, 'anchors.jsonl'), SECRET);
    await store.record({ headHash: v.headHash!, checked: v.checked });
    // No further writes; anchor must validate.
    const r = await store.verifyLatest({
      currentHeadHash: v.headHash,
      currentChecked: v.checked,
      headAt: (n) => log.hashAt(n),
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.signatureValid).toBe(true);
    expect(r.chainMatches).toBe(true);
  });

  it('verifyLatest still ok after the chain grows past the anchor', async () => {
    const log = new AuditLog(join(dir, 'audit.log'));
    await log.write({ actor: 'u', action: 'a', resource: '/x' });
    await log.write({ actor: 'u', action: 'b', resource: '/y' });
    const v1 = await log.verify();
    const store = new AuditAnchorStore(join(dir, 'anchors.jsonl'), SECRET);
    await store.record({ headHash: v1.headHash!, checked: v1.checked });
    await log.write({ actor: 'u', action: 'c', resource: '/z' });
    const v2 = await log.verify();
    const r = await store.verifyLatest({
      currentHeadHash: v2.headHash,
      currentChecked: v2.checked,
      headAt: (n) => log.hashAt(n),
    });
    expect(r.ok).toBe(true);
    expect(r.chainMatches).toBe(true);
  });

  it('detects truncation: chain is shorter than the anchored count', async () => {
    const log = new AuditLog(join(dir, 'audit.log'));
    await log.write({ actor: 'u', action: 'a', resource: '/x' });
    await log.write({ actor: 'u', action: 'b', resource: '/y' });
    await log.write({ actor: 'u', action: 'c', resource: '/z' });
    const v = await log.verify();
    const store = new AuditAnchorStore(join(dir, 'anchors.jsonl'), SECRET);
    await store.record({ headHash: v.headHash!, checked: v.checked });
    // Drop the tail line, simulating a truncation attack on the audit log.
    const file = join(dir, 'audit.log');
    const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
    await writeFile(file, lines.slice(0, 1).join('\n') + '\n', 'utf8');
    const v2 = await log.verify();
    const r = await store.verifyLatest({
      currentHeadHash: v2.headHash,
      currentChecked: v2.checked,
      headAt: (n) => log.hashAt(n),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('chain-truncated');
    expect(r.signatureValid).toBe(true);
  });

  it('detects a rewrite that lands at the same position with a different hash', async () => {
    const log = new AuditLog(join(dir, 'audit.log'));
    await log.write({ actor: 'u', action: 'a', resource: '/x' });
    await log.write({ actor: 'u', action: 'b', resource: '/y' });
    const v = await log.verify();
    const store = new AuditAnchorStore(join(dir, 'anchors.jsonl'), SECRET);
    await store.record({ headHash: v.headHash!, checked: v.checked });

    // Bypass the AuditLog API to fabricate a "fresh" chain of two records
    // that occupy the anchored positions but with totally different hashes.
    // This simulates an attacker who deleted the on-disk log and rebuilt it
    // from forged events.
    const file = join(dir, 'audit.log');
    await writeFile(file, '', 'utf8');
    const fresh = new AuditLog(file);
    await fresh.write({ actor: 'attacker', action: 'cover', resource: '/q' });
    await fresh.write({ actor: 'attacker', action: 'tracks', resource: '/q' });
    const v2 = await fresh.verify();
    const r = await store.verifyLatest({
      currentHeadHash: v2.headHash,
      currentChecked: v2.checked,
      headAt: (n) => fresh.hashAt(n),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('chain-rewritten');
    expect(r.signatureValid).toBe(true);
  });

  it('detects a forged anchor (HMAC over the wrong secret)', async () => {
    const store = new AuditAnchorStore(join(dir, 'anchors.jsonl'), SECRET);
    // Write an anchor record under a different secret directly to the file.
    const file = join(dir, 'anchors.jsonl');
    const forged = new AuditAnchorStore(file, 'attacker-secret');
    await forged.record({ headHash: 'cafebabe', checked: 1 });
    const r = await store.verifyLatest({
      currentHeadHash: 'cafebabe',
      currentChecked: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad-signature');
    expect(r.signatureValid).toBe(false);
  });

  it('reports no-anchors on an empty store', async () => {
    const store = new AuditAnchorStore(join(dir, 'anchors.jsonl'), SECRET);
    const r = await store.verifyLatest({
      currentHeadHash: 'whatever',
      currentChecked: 0,
    });
    expect(r.reason).toBe('no-anchors');
    expect(r.anchor).toBeNull();
  });
});
