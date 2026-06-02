import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Workspace Query Blocklist.
//
// A small, owner-managed list of patterns that any inbound query (ask /
// search / explain / stream) is matched against BEFORE it reaches the
// retriever or the LLM. Procurement teams ask for this for three
// concrete reasons:
//
//   1. Prompt-injection / jailbreak triage. Security teams want a
//      same-day way to add "ignore previous instructions" or a leaked
//      payload string and have every API key in the workspace start
//      refusing it immediately, with no deploy.
//   2. Banned topics. Regulated industries (legal, health, finance)
//      need to demonstrate that named-customer or named-matter strings
//      cannot be searched by users who lack standing.
//   3. Egress prevention. PII patterns (social-security numbers, raw
//      API tokens) typed into the query box should not be sent to an
//      external LLM in the first place. Blocking pre-retrieval is the
//      only correct place: blocking after retrieval still leaks.
//
// Match modes:
//   * literal     case-insensitive substring match. Default. Cheap.
//   * regex       JS RegExp compiled once at load. Validated at write.
//
// All matches return 422 with `error: 'query-blocked'` so a calling
// client can distinguish from 400 (malformed) or 403 (permission). The
// route layer also emits an audit entry per block with the matched
// pattern id (never the raw query, to avoid logging the secret the user
// just tried to send).
//
// On-disk layout: <dataDir>/query-blocklist.json. Atomic tmp+rename.
// Single workspace per deployment matching every other policy file.

export const MAX_PATTERNS = 200;
export const MAX_PATTERN_LEN = 500;
export const MAX_LABEL_LEN = 120;

export type BlocklistMode = 'literal' | 'regex';

export interface BlocklistRule {
  id: string;
  pattern: string;
  mode: BlocklistMode;
  label: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface QueryBlocklistFile {
  version: 1;
  rules: BlocklistRule[];
}

const FILE = 'query-blocklist.json';

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

export class BlocklistValidationError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
    this.name = 'BlocklistValidationError';
  }
}

export interface BlockMatch {
  ruleId: string;
  mode: BlocklistMode;
  label: string | null;
}

async function loadAll(dataDir: string): Promise<QueryBlocklistFile> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as QueryBlocklistFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.rules)) {
      return { version: 1, rules: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, rules: [] };
    }
    throw err;
  }
}

async function saveAll(dataDir: string, all: QueryBlocklistFile): Promise<void> {
  const p = file(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
  await rename(tmp, p);
}

function normaliseLabel(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new BlocklistValidationError('label', 'label must be a string or null');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_LABEL_LEN) {
    throw new BlocklistValidationError('label', `label must be <= ${MAX_LABEL_LEN} characters`);
  }
  return trimmed;
}

function validatePattern(pattern: unknown, mode: BlocklistMode): string {
  if (typeof pattern !== 'string') {
    throw new BlocklistValidationError('pattern', 'pattern must be a string');
  }
  const trimmed = pattern.trim();
  if (trimmed.length === 0) {
    throw new BlocklistValidationError('pattern', 'pattern is required');
  }
  if (trimmed.length > MAX_PATTERN_LEN) {
    throw new BlocklistValidationError(
      'pattern',
      `pattern must be <= ${MAX_PATTERN_LEN} characters`,
    );
  }
  if (mode === 'regex') {
    try {
      // eslint-disable-next-line no-new
      new RegExp(trimmed, 'i');
    } catch (err) {
      throw new BlocklistValidationError(
        'pattern',
        `invalid regex: ${(err as Error).message}`,
      );
    }
  }
  return trimmed;
}

function validateMode(mode: unknown): BlocklistMode {
  if (mode === 'literal' || mode === 'regex') return mode;
  throw new BlocklistValidationError('mode', 'mode must be "literal" or "regex"');
}

export async function listRules(dataDir: string): Promise<BlocklistRule[]> {
  const all = await loadAll(dataDir);
  return all.rules.slice().sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Filter a list of blocklist rules by a case-insensitive substring that
 * matches the rule's pattern or its label. Empty/whitespace `q` returns the
 * input unchanged. Mirrors `filterMutes` so the same admin search box can
 * triage a long blocklist (e.g. find every rule labelled "prompt-injection"
 * or every rule whose pattern mentions "ssn").
 */
export function filterRules(
  rules: BlocklistRule[],
  q: string | undefined,
): BlocklistRule[] {
  const needle = q?.trim().toLowerCase();
  if (!needle) return rules;
  return rules.filter((r) => {
    const hay = `${r.pattern}\n${r.label ?? ''}`.toLowerCase();
    return hay.includes(needle);
  });
}

export interface AddRuleInput {
  pattern: string;
  mode?: BlocklistMode;
  label?: string | null;
}

export async function addRule(
  dataDir: string,
  actorUserId: string,
  input: AddRuleInput,
): Promise<BlocklistRule> {
  const mode = validateMode(input.mode ?? 'literal');
  const pattern = validatePattern(input.pattern, mode);
  const label = normaliseLabel(input.label);
  const now = Date.now();
  const all = await loadAll(dataDir);
  if (all.rules.length >= MAX_PATTERNS) {
    throw new BlocklistValidationError(
      'pattern',
      `workspace already has ${MAX_PATTERNS} rules; remove one before adding another`,
    );
  }
  // De-dupe on (mode, pattern lowercased for literal, raw for regex).
  const dupKey = mode === 'literal' ? pattern.toLowerCase() : pattern;
  const exists = all.rules.find(
    (r) => r.mode === mode && (r.mode === 'literal' ? r.pattern.toLowerCase() : r.pattern) === dupKey,
  );
  if (exists) {
    throw new BlocklistValidationError('pattern', 'pattern already exists');
  }
  const rule: BlocklistRule = {
    id: randomBytes(8).toString('hex'),
    pattern,
    mode,
    label,
    createdBy: actorUserId,
    createdAt: now,
    updatedAt: now,
  };
  all.rules.push(rule);
  await saveAll(dataDir, all);
  return rule;
}

export async function removeRule(
  dataDir: string,
  id: string,
): Promise<BlocklistRule | null> {
  const all = await loadAll(dataDir);
  const idx = all.rules.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const [removed] = all.rules.splice(idx, 1);
  await saveAll(dataDir, all);
  return removed ?? null;
}

/**
 * Check a query string against the workspace blocklist. Returns the
 * first matching rule, or null if the query is allowed. Match cost is
 * linear in rules; MAX_PATTERNS keeps that bounded.
 */
export async function matchQuery(
  dataDir: string,
  q: string,
): Promise<BlockMatch | null> {
  if (typeof q !== 'string' || q.length === 0) return null;
  const all = await loadAll(dataDir);
  if (all.rules.length === 0) return null;
  const lower = q.toLowerCase();
  for (const rule of all.rules) {
    if (rule.mode === 'literal') {
      if (lower.includes(rule.pattern.toLowerCase())) {
        return { ruleId: rule.id, mode: 'literal', label: rule.label };
      }
    } else {
      try {
        const re = new RegExp(rule.pattern, 'i');
        if (re.test(q)) {
          return { ruleId: rule.id, mode: 'regex', label: rule.label };
        }
      } catch {
        // A previously-valid regex became invalid (shouldn't happen since
        // we validate on write). Skip rather than 500 the request.
      }
    }
  }
  return null;
}
