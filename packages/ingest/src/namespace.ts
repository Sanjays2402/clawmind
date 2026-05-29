import { sep } from 'node:path';
import type { Namespace } from '@clawmind/types';

export function inferNamespace(absPath: string): Namespace {
  const lower = absPath.toLowerCase();
  if (lower.includes(`${sep}memory${sep}`) || lower.endsWith(`${sep}memory.md`)) return 'memory';
  if (lower.includes(`${sep}sessions${sep}`) || lower.includes(`${sep}session-logs${sep}`)) return 'sessions';
  if (lower.includes(`${sep}projects${sep}`) || lower.includes(`${sep}workspace${sep}skills${sep}`)) return 'projects';
  if (lower.includes(`${sep}docs${sep}`) || lower.endsWith('.md')) return 'docs';
  return 'misc';
}
