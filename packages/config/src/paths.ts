import { homedir } from 'node:os';
import { resolve } from 'node:path';

export function expand(p: string): string {
  if (p.startsWith('~')) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

export function dataDir(env: { CLAWMIND_DATA_DIR: string }) {
  return expand(env.CLAWMIND_DATA_DIR);
}
export function lancedbDir(env: { CLAWMIND_DATA_DIR: string }) {
  return resolve(dataDir(env), 'lancedb');
}
export function bm25Dir(env: { CLAWMIND_DATA_DIR: string }) {
  return resolve(dataDir(env), 'bm25');
}
export function manifestPath(env: { CLAWMIND_DATA_DIR: string }) {
  return resolve(dataDir(env), 'ingest-manifest.json');
}
export function auditPath(env: { CLAWMIND_DATA_DIR: string }) {
  return resolve(dataDir(env), 'audit.log');
}
