import { readFile } from 'node:fs/promises';
import { dirname, relative, sep, posix } from 'node:path';

/**
 * Lightweight gitignore-style matcher used for `.clawmindignore` files.
 *
 * Supports the subset of gitignore syntax that matters for ingest scoping:
 *   - blank lines and `#` comments are skipped
 *   - leading `!` negates a previous match (un-ignore)
 *   - leading `/` anchors the pattern to the file's directory
 *   - trailing `/` matches directories only
 *   - `*` matches anything except `/`
 *   - `**` matches across path separators
 *   - `?` matches a single non-separator character
 *
 * Patterns from a `.clawmindignore` file are scoped to the directory that
 * contains the file (just like git). Patterns from nested files take
 * precedence over patterns from ancestor files.
 */

export interface IgnoreRule {
  /** Pattern as written in the file, without the optional leading `!`. */
  pattern: string;
  /** Compiled regex applied to the relative POSIX path. */
  re: RegExp;
  /** True if the pattern starts with `!` (re-includes the path). */
  negate: boolean;
  /** True if the pattern ends with `/`, restricting it to directories. */
  dirOnly: boolean;
  /** Directory the rule was loaded from (absolute, POSIX form). */
  base: string;
}

export interface IgnoreSet {
  rules: IgnoreRule[];
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/** Compile a single gitignore-style pattern to a RegExp. */
export function compilePattern(pattern: string): { re: RegExp; dirOnly: boolean; anchored: boolean } {
  let p = pattern;
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.startsWith('/');
  if (anchored) p = p.slice(1);

  // Build regex character by character so we can handle ** properly.
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]!;
    if (ch === '*') {
      if (p[i + 1] === '*') {
        // ** matches any sequence including slashes; consume optional /
        re += '.*';
        i += 1;
        if (p[i + 1] === '/') i += 1;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '/') {
      re += '/';
    } else {
      re += escapeRegex(ch);
    }
  }
  // If the pattern has no slash and is not anchored, it should match in any directory.
  const hasSlash = p.includes('/');
  const prefix = anchored || hasSlash ? '^' : '^(?:.*/)?';
  const suffix = dirOnly ? '(?:/.*)?$' : '(?:/.*)?$';
  return { re: new RegExp(prefix + re + suffix), dirOnly, anchored };
}

/** Parse a `.clawmindignore` file body into compiled rules. */
export function parseIgnoreFile(body: string, base: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s+|\s+$/g, '');
    if (!line || line.startsWith('#')) continue;
    let pattern = line;
    let negate = false;
    if (pattern.startsWith('!')) {
      negate = true;
      pattern = pattern.slice(1);
    }
    // Allow escaping `#` and `!` at start.
    if (pattern.startsWith('\\#') || pattern.startsWith('\\!')) pattern = pattern.slice(1);
    if (!pattern) continue;
    const compiled = compilePattern(pattern);
    rules.push({ pattern, re: compiled.re, negate, dirOnly: compiled.dirOnly, base: toPosix(base) });
  }
  return rules;
}

/** Try to load `.clawmindignore` from a directory; returns [] if absent. */
export async function loadIgnoreFile(dir: string): Promise<IgnoreRule[]> {
  try {
    const body = await readFile(`${dir}/.clawmindignore`, 'utf8');
    return parseIgnoreFile(body, dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Load `.clawmindignore` from `root` and from every ancestor of each provided
 * file path up to (and not above) `root`. Files are read at most once.
 */
export async function loadIgnoreSet(root: string, paths: string[]): Promise<IgnoreSet> {
  const rootPosix = toPosix(root).replace(/\/$/, '');
  const seen = new Set<string>();
  const rules: IgnoreRule[] = [];

  // Root first so nested rules sort later and win ties.
  const queue: string[] = [rootPosix];
  for (const p of paths) {
    let d = toPosix(dirname(p));
    while (d.length >= rootPosix.length && d.startsWith(rootPosix)) {
      queue.push(d);
      if (d === rootPosix) break;
      const next = d.substring(0, d.lastIndexOf('/'));
      if (next === d) break;
      d = next;
    }
  }
  // De-duplicate while keeping ancestor-first ordering.
  const ordered = [...new Set(queue)].sort((a, b) => a.length - b.length);
  for (const dir of ordered) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    const loaded = await loadIgnoreFile(dir);
    rules.push(...loaded);
  }
  return { rules };
}

/**
 * Return `true` when the given absolute path is ignored by the rule set.
 * `isDir` should be true for directories; defaults to false (file).
 */
export function isIgnored(set: IgnoreSet, root: string, absPath: string, isDir = false): boolean {
  const rootPosix = toPosix(root).replace(/\/$/, '');
  const abs = toPosix(absPath);
  if (!abs.startsWith(rootPosix)) return false;

  let ignored = false;
  for (const rule of set.rules) {
    if (rule.dirOnly && !isDir) continue;
    // Path relative to the rule's base directory.
    const rel = toPosix(relative(rule.base, abs));
    if (rel.startsWith('..') || rel === '') continue;
    if (rule.re.test(rel)) {
      ignored = !rule.negate;
    }
  }
  return ignored;
}

/** Filter a list of absolute file paths against `.clawmindignore` rules. */
export async function filterIgnored(root: string, files: string[]): Promise<string[]> {
  const set = await loadIgnoreSet(root, files);
  if (set.rules.length === 0) return files;
  const kept: string[] = [];
  for (const f of files) {
    if (!isIgnored(set, root, f, false)) kept.push(f);
  }
  return kept;
}

// Keep `posix` import used (tree-shaking guards in some bundlers complain otherwise).
void posix;
