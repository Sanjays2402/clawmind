import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { Document } from '@clawmind/types';
import { shortHash } from '../hash.js';
import { inferNamespace } from '../namespace.js';

const EXT_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.rb': 'ruby', '.java': 'java',
  '.swift': 'swift', '.sh': 'bash', '.zsh': 'bash', '.yml': 'yaml', '.yaml': 'yaml',
  '.toml': 'toml', '.html': 'html', '.css': 'css', '.sql': 'sql',
};

export async function loadCode(path: string): Promise<{ doc: Document; body: string }> {
  const raw = await readFile(path, 'utf8');
  const st = await stat(path);
  const namespace = inferNamespace(path);
  const ext = extname(path).toLowerCase();
  const doc: Document = {
    id: shortHash(path),
    path,
    namespace,
    title: basename(path),
    mtime: st.mtimeMs,
    size: st.size,
    hash: shortHash(raw),
    language: EXT_LANG[ext] ?? 'text',
  };
  return { doc, body: raw };
}

export function isCodeFile(path: string): boolean {
  return Object.keys(EXT_LANG).includes(extname(path).toLowerCase());
}
