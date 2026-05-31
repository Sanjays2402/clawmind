import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  exportWorkspace,
  previewWorkspaceExport,
  workspaceBundleToZipEntries,
  WORKSPACE_EXPORT_SCHEMA,
  WORKSPACE_EXPORT_PREVIEW_SCHEMA,
} from '../src/services/workspace-export.js';
import { buildZip } from '../src/services/zip-export.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-ws-export-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

async function seed() {
  // Members file: a 2-member workspace.
  await writeFile(
    join(dir, 'members.json'),
    JSON.stringify({
      version: 1,
      members: [
        { userId: 'alice', role: 'owner', email: 'alice@example.com' },
        { userId: 'bob', role: 'member', email: 'bob@example.com' },
      ],
    }),
  );
  // History from both users — workspace export must include *both*, unlike
  // the per-user export which scopes by userId.
  await writeFile(
    join(dir, 'history.jsonl'),
    [
      JSON.stringify({ id: 'h1', ts: 1, userId: 'alice', query: 'q', answer: 'a', sources: [], model: 'm' }),
      JSON.stringify({ id: 'h2', ts: 2, userId: 'bob', query: 'q', answer: 'a', sources: [], model: 'm' }),
    ].join('\n') + '\n',
  );
  await mkdir(join(dir, 'conversations'), { recursive: true });
  await writeFile(
    join(dir, 'conversations', 'c1.json'),
    JSON.stringify({ id: 'c1', userId: 'alice', title: 't', createdAt: 1, updatedAt: 1, turns: [] }),
  );
  await writeFile(
    join(dir, 'conversations', 'c2.json'),
    JSON.stringify({ id: 'c2', userId: 'bob', title: 't', createdAt: 1, updatedAt: 1, turns: [] }),
  );
  await writeFile(join(dir, 'saved.json'), JSON.stringify([
    { id: 's1', userId: 'alice', title: 't', query: 'q', createdAt: 1 },
    { id: 's2', userId: 'bob', title: 't', query: 'q', createdAt: 1 },
  ]));
  await writeFile(join(dir, 'feedback.json'), JSON.stringify({
    'docs/a.md': { path: 'docs/a.md', ups: 2, downs: 0, byUser: { alice: 1, bob: 1 }, updatedAt: 10 },
  }));
  await writeFile(join(dir, 'api-keys.json'), JSON.stringify([
    { id: 'k1', userId: 'alice', label: 'l', hash: 'SECRET_BCRYPT_HASH', scopes: ['*'], createdAt: 1 },
  ]));
  await writeFile(join(dir, 'pins.json'), JSON.stringify(['docs/a.md', 'docs/b.md']));
  await writeFile(join(dir, 'audit.log'),
    JSON.stringify({ id: 'e1', ts: 1, actor: 'alice', action: 'login' }) + '\n' +
    JSON.stringify({ id: 'e2', ts: 2, actor: 'bob', action: 'login' }) + '\n',
  );
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({
    docs: { 'a.md': { hash: 'x' }, 'b.md': { hash: 'y' } },
  }));
}

describe('workspace-export', () => {
  it('preview counts every workspace-scoped record without writing anything', async () => {
    await seed();
    const preview = await previewWorkspaceExport(dir);
    expect(preview.schema).toBe(WORKSPACE_EXPORT_PREVIEW_SCHEMA);
    expect(preview.dryRun).toBe(true);
    expect(preview.counts.members).toBe(2);
    expect(preview.counts.history).toBe(2);
    expect(preview.counts.conversations).toBe(2);
    expect(preview.counts.saved).toBe(2);
    expect(preview.counts.feedback).toBe(1);
    expect(preview.counts.apiKeys).toBe(1);
    expect(preview.counts.pins).toBe(2);
    expect(preview.counts.auditEvents).toBe(2);
    expect(preview.counts.ingestDocs).toBe(2);
    expect(preview.estimatedBytes).toBeGreaterThan(0);
  });

  it('export includes records from EVERY user (tenant-wide, not per-user)', async () => {
    await seed();
    const bundle = await exportWorkspace(dir, 'alice');
    expect(bundle.schema).toBe(WORKSPACE_EXPORT_SCHEMA);
    expect(bundle.exportedBy).toBe('alice');
    const userIds = new Set(bundle.history.map((h) => h.userId));
    expect(userIds.has('alice')).toBe(true);
    expect(userIds.has('bob')).toBe(true);
    const convUsers = new Set(bundle.conversations.map((c) => c.userId));
    expect(convUsers.has('alice')).toBe(true);
    expect(convUsers.has('bob')).toBe(true);
    expect(bundle.saved.length).toBe(2);
    expect(bundle.auditEvents.length).toBe(2);
    expect(bundle.members.length).toBe(2);
  });

  it('strips secret material (api-key hashes never appear in the export)', async () => {
    await seed();
    const bundle = await exportWorkspace(dir, 'alice');
    const blob = JSON.stringify(bundle);
    expect(blob).not.toContain('SECRET_BCRYPT_HASH');
    // And explicitly the apiKeys entries must not carry a `hash` field.
    for (const k of bundle.apiKeys) {
      expect((k as Record<string, unknown>).hash).toBeUndefined();
    }
  });

  it('handles a brand-new dataDir gracefully (zeroes everywhere)', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'cm-ws-export-empty-'));
    try {
      const preview = await previewWorkspaceExport(empty);
      expect(preview.counts.history).toBe(0);
      expect(preview.counts.members).toBe(0);
      const bundle = await exportWorkspace(empty, 'noone');
      expect(bundle.history).toEqual([]);
      expect(bundle.conversations).toEqual([]);
      expect(bundle.apiKeys).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('zips into a valid PKZIP archive with the expected entries', async () => {
    await seed();
    const bundle = await exportWorkspace(dir, 'alice');
    const entries = workspaceBundleToZipEntries(bundle);
    const names = entries.map((e) => e.name);
    expect(names).toContain('manifest.json');
    expect(names).toContain('members.json');
    expect(names).toContain('history.json');
    expect(names).toContain('audit.json');
    expect(names).toContain('README.txt');
    const zip = buildZip(entries);
    // PK\x03\x04 local-file-header signature.
    expect(zip.slice(0, 4).toString('hex')).toBe('504b0304');
    expect(zip.length).toBeGreaterThan(0);
  });
});
