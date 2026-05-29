import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import matter from 'gray-matter';
import type { Document } from '@clawmind/types';
import { shortHash } from '../hash.js';
import { inferNamespace } from '../namespace.js';

export interface LoadedDoc {
  doc: Document;
  body: string;
}

export async function loadMarkdown(path: string): Promise<LoadedDoc> {
  const raw = await readFile(path, 'utf8');
  const st = await stat(path);
  const parsed = matter(raw);
  const namespace = inferNamespace(path);
  const title = (parsed.data.title as string | undefined) ?? basename(path, extname(path));
  const id = shortHash(path);
  const doc: Document = {
    id,
    path,
    namespace,
    title,
    mtime: st.mtimeMs,
    size: st.size,
    hash: shortHash(raw),
    frontmatter: parsed.data as Record<string, unknown>,
    language: 'markdown',
  };
  return { doc, body: parsed.content };
}
