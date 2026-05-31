// Tiny zero-dependency ZIP writer (STORE method, no compression) used to
// bundle the per-user GDPR export into a single download. Enterprise
// procurement reviewers ask for "JSON or CSV in a ZIP" because their
// downstream tooling (Excel, BI imports, legal hold systems) wants a flat
// folder of files, not a single nested JSON blob. We deliberately implement
// the ZIP format inline rather than pull in JSZip/archiver: the per-user
// bundle is small, and adding a transitive dep to the API surface for one
// download path is not worth the supply-chain risk on a security-reviewed
// product.
//
// Spec reference: PKWARE APPNOTE.TXT, sections 4.3.7 (Local File Header),
// 4.3.12 (Central Directory Header) and 4.3.16 (End of Central Directory).
// We only emit version 2.0, deflate disabled, no Zip64, no encryption.

import { crc32 } from 'node:zlib';
import { Buffer } from 'node:buffer';
import type { UserDataExport } from './lifecycle.js';

interface ZipEntry {
  name: string;
  data: Buffer;
}

interface CentralDirEntry {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
}

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;

function dosDateTime(d: Date): { date: number; time: number } {
  const date =
    ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time =
    (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { date, time };
}

export function buildZip(entries: ZipEntry[], now: Date = new Date()): Buffer {
  const { date, time } = dosDateTime(now);
  const parts: Buffer[] = [];
  const central: CentralDirEntry[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIG, 0);
    localHeader.writeUInt16LE(20, 4);            // version needed
    localHeader.writeUInt16LE(1 << 11, 6);       // general purpose: utf8 names
    localHeader.writeUInt16LE(0, 8);             // method = stored
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);            // extra field length

    parts.push(localHeader, nameBuf, entry.data);
    central.push({ name: nameBuf, crc, size, offset });
    offset += localHeader.length + nameBuf.length + entry.data.length;
  }

  const centralStart = offset;
  for (const c of central) {
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(CENTRAL_DIR_SIG, 0);
    cdh.writeUInt16LE(20, 4);                    // version made by
    cdh.writeUInt16LE(20, 6);                    // version needed
    cdh.writeUInt16LE(1 << 11, 8);               // utf8 names
    cdh.writeUInt16LE(0, 10);                    // method = stored
    cdh.writeUInt16LE(time, 12);
    cdh.writeUInt16LE(date, 14);
    cdh.writeUInt32LE(c.crc, 16);
    cdh.writeUInt32LE(c.size, 20);
    cdh.writeUInt32LE(c.size, 24);
    cdh.writeUInt16LE(c.name.length, 28);
    cdh.writeUInt16LE(0, 30);                    // extra
    cdh.writeUInt16LE(0, 32);                    // comment
    cdh.writeUInt16LE(0, 34);                    // disk number
    cdh.writeUInt16LE(0, 36);                    // internal attrs
    cdh.writeUInt32LE(0, 38);                    // external attrs
    cdh.writeUInt32LE(c.offset, 42);
    parts.push(cdh, c.name);
    offset += cdh.length + c.name.length;
  }

  const centralSize = offset - centralStart;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(END_OF_CENTRAL_DIR_SIG, 0);
  eocd.writeUInt16LE(0, 4);                      // disk number
  eocd.writeUInt16LE(0, 6);                      // start disk
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);                     // comment length
  parts.push(eocd);

  return Buffer.concat(parts);
}

// RFC 4180 CSV: quote every field, double-up embedded quotes, CRLF line
// endings. Keeping it simple and unconditional means Excel imports cleanly
// without sniffing escape rules.
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return '"' + s.replace(/"/g, '""') + '"';
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(csvCell).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')).join('\r\n');
  return body.length > 0 ? header + '\r\n' + body + '\r\n' : header + '\r\n';
}

// Flatten the bundle into CSVs + a manifest. Keeping the original JSON file
// in the same archive means lossy CSV conversions never become the only
// surviving copy: legal hold gets the structured truth alongside the
// spreadsheet-friendly view.
export function bundleToZip(bundle: UserDataExport, now: Date = new Date()): Buffer {
  const historyCsv = toCsv(
    bundle.history.map((h) => ({
      id: h.id,
      ts: new Date(h.ts).toISOString(),
      query: h.query,
      answer: h.answer,
      model: h.model,
      sources: (h.sources as Array<{ path?: string }>)
        .map((s) => (s && typeof s === 'object' && typeof s.path === 'string' ? s.path : ''))
        .filter(Boolean)
        .join('|'),
    })),
    ['id', 'ts', 'query', 'answer', 'model', 'sources'],
  );

  const conversationsCsv = toCsv(
    bundle.conversations.flatMap((c) =>
      (c.turns ?? []).map((t, i) => ({
        conversationId: c.id,
        title: c.title,
        turn: i,
        role: t.role,
        content: t.content,
        createdAt: new Date(c.createdAt).toISOString(),
      })),
    ),
    ['conversationId', 'title', 'turn', 'role', 'content', 'createdAt'],
  );

  const savedCsv = toCsv(
    bundle.saved.map((s) => ({
      id: s.id,
      title: s.title,
      query: s.query,
      createdAt: new Date(s.createdAt).toISOString(),
    })),
    ['id', 'title', 'query', 'createdAt'],
  );

  const feedbackCsv = toCsv(
    bundle.feedback.map((f) => ({
      path: f.path,
      vote: f.vote,
      updatedAt: new Date(f.updatedAt).toISOString(),
    })),
    ['path', 'vote', 'updatedAt'],
  );

  const apiKeysCsv = toCsv(
    bundle.apiKeys.map((k) => ({
      id: (k as { id: string }).id,
      label: (k as { label: string }).label,
      role: (k as { role: string }).role,
      createdAt: new Date((k as { createdAt: number }).createdAt).toISOString(),
      lastUsedAt: (k as { lastUsedAt?: number }).lastUsedAt
        ? new Date((k as { lastUsedAt: number }).lastUsedAt).toISOString()
        : '',
    })),
    ['id', 'label', 'role', 'createdAt', 'lastUsedAt'],
  );

  const manifest = {
    schema: 'clawmind.user-export.zip.v1',
    bundleSchema: bundle.schema,
    userId: bundle.userId,
    exportedAt: bundle.exportedAt,
    exportedAtIso: new Date(bundle.exportedAt).toISOString(),
    counts: {
      history: bundle.history.length,
      conversations: bundle.conversations.length,
      saved: bundle.saved.length,
      feedback: bundle.feedback.length,
      apiKeys: bundle.apiKeys.length,
    },
    files: [
      'manifest.json',
      'export.json',
      'history.csv',
      'conversations.csv',
      'saved.csv',
      'feedback.csv',
      'api-keys.csv',
      'README.txt',
    ],
  };

  const readme =
    'Clawmind user data export\r\n' +
    '\r\n' +
    'manifest.json     summary, schema version, row counts\r\n' +
    'export.json       full structured bundle (lossless)\r\n' +
    '*.csv             flattened views for spreadsheets and BI tools\r\n' +
    '\r\n' +
    'The JSON bundle is the source of truth. CSVs are derived views and\r\n' +
    'may lose nested structure such as per-source citation metadata.\r\n';

  return buildZip(
    [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
      { name: 'export.json', data: Buffer.from(JSON.stringify(bundle, null, 2)) },
      { name: 'history.csv', data: Buffer.from(historyCsv) },
      { name: 'conversations.csv', data: Buffer.from(conversationsCsv) },
      { name: 'saved.csv', data: Buffer.from(savedCsv) },
      { name: 'feedback.csv', data: Buffer.from(feedbackCsv) },
      { name: 'api-keys.csv', data: Buffer.from(apiKeysCsv) },
      { name: 'README.txt', data: Buffer.from(readme) },
    ],
    now,
  );
}
