import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Document } from '@clawmind/types';
import { shortHash } from '../hash.js';
import { inferNamespace } from '../namespace.js';

export async function loadJson(path: string): Promise<{ doc: Document; body: string }> {
  const raw = await readFile(path, 'utf8');
  const st = await stat(path);
  let pretty = raw;
  try { pretty = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* keep raw */ }
  const doc: Document = {
    id: shortHash(path),
    path,
    namespace: inferNamespace(path),
    title: basename(path),
    mtime: st.mtimeMs,
    size: st.size,
    hash: shortHash(raw),
    language: 'json',
  };
  return { doc, body: pretty };
}
