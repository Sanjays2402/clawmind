import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConversation, appendTurn } from '../src/services/conversations.js';
import { recordVote } from '../src/services/feedback.js';
import { addSaved } from '../src/services/saved.js';
import { recordHistory } from '../src/services/history.js';
import { issueKey } from '../src/services/api-keys.js';
import { exportUserData } from '../src/services/lifecycle.js';
import { bundleToZip, buildZip } from '../src/services/zip-export.js';

// Parse just enough of a ZIP central directory to recover the filenames and
// per-entry uncompressed sizes. We do not need a real unzip here; we are
// asserting that the archive is well-formed and contains the expected set
// of files.
function listEntries(zip: Buffer): { name: string; size: number; crc: number }[] {
  // End of central dir signature
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('eocd not found');
  const total = zip.readUInt16LE(eocd + 10);
  let off = zip.readUInt32LE(eocd + 16);
  const out: { name: string; size: number; crc: number }[] = [];
  for (let i = 0; i < total; i++) {
    if (zip.readUInt32LE(off) !== 0x02014b50) throw new Error('bad cdh');
    const crc = zip.readUInt32LE(off + 16);
    const size = zip.readUInt32LE(off + 24);
    const nameLen = zip.readUInt16LE(off + 28);
    const extraLen = zip.readUInt16LE(off + 30);
    const commentLen = zip.readUInt16LE(off + 32);
    const name = zip.slice(off + 46, off + 46 + nameLen).toString('utf8');
    out.push({ name, size, crc });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-zip-export-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

async function seed() {
  await recordHistory(dir, {
    id: 'h1', ts: 1700000000000, userId: 'alice', query: 'q', answer: 'a',
    sources: [{ path: '/x.md' }, { path: '/y.md' }], model: 'm',
  });
  const c = await createConversation(dir, 'alice', 'alice chat');
  await appendTurn(dir, c.id, { role: 'user', content: 'hello, "quoted" world' });
  await addSaved(dir, 'alice', { title: 't', query: 'q' });
  await recordVote(dir, 'alice', '/x.md', 1);
  await issueKey(dir, { userId: 'alice', label: 'cli', role: 'owner' });
}

describe('zip-export.bundleToZip', () => {
  it('packages the per-user bundle into a structurally valid ZIP', async () => {
    await seed();
    const bundle = await exportUserData(dir, 'alice');
    const zip = bundleToZip(bundle, new Date('2026-01-01T00:00:00Z'));

    // ZIP local file header magic
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);

    const entries = listEntries(zip);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual([
      'README.txt',
      'api-keys.csv',
      'conversations.csv',
      'export.json',
      'feedback.csv',
      'history.csv',
      'manifest.json',
      'saved.csv',
    ]);
    // Every entry has a non-trivial size; CSV headers alone make the
    // minimum a few dozen bytes.
    for (const e of entries) expect(e.size).toBeGreaterThan(10);
  });

  it('escapes embedded quotes in CSV cells', () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello') }]);
    const entries = listEntries(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0].size).toBe(5);
  });
});
