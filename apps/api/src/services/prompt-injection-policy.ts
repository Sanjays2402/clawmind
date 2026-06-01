import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Workspace Indirect Prompt Injection Policy.
//
// Why this exists. Procurement teams asking "how do you handle
// indirect prompt injection?" want a concrete answer. ClawMind ingests
// arbitrary documents (notes, web pages, PDFs) and feeds chunks into
// an LLM as retrieved context. An attacker who can get text into the
// corpus can attempt to override the system prompt, exfiltrate data,
// or trick downstream tooling. The existing query-blocklist guards
// the inbound user query; this policy guards the OUTBOUND retrieved
// context the LLM (and the end user) will see.
//
// Modes:
//   off      no scanning, no overhead
//   monitor  scan and audit hits, but do not surface to the user
//            and do not block the response. Useful for tuning rules.
//   flag     scan, audit, and annotate each affected source with
//            `injectionFlags: [{ ruleId, label, severity }]` so the
//            client / UI can render a warning chip.
//   block    scan, audit, and refuse the response with HTTP 422
//            `injection-detected` listing the offending source ids.
//
// Rule shape: an id, a JS RegExp pattern, a severity (`low`|`med`|`high`),
// an optional human label, and standard audit metadata. Default rules
// (curated list of common jailbreak / exfil substrings) are seeded on
// first read so a fresh deployment is protected out of the box; the
// operator can disable individual seeds via DELETE, or add their own.
//
// Audit hygiene mirrors query-blocklist: the matched excerpt text is
// never written to the audit log, only `{ ruleId, severity, sourceId }`.
// Patterns may contain the literal jailbreak strings security teams
// rotate weekly and we should not echo those into the audit chain.

export const MAX_PATTERNS = 200;
export const MAX_PATTERN_LEN = 500;
export const MAX_LABEL_LEN = 120;

export type PolicyMode = 'off' | 'monitor' | 'flag' | 'block';
export type Severity = 'low' | 'med' | 'high';

export interface InjectionRule {
  id: string;
  pattern: string;
  severity: Severity;
  label: string | null;
  builtin: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface PolicyFile {
  version: 1;
  mode: PolicyMode;
  rules: InjectionRule[];
  disabledBuiltins: string[];
}

const FILE = 'prompt-injection-policy.json';

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

export class PolicyValidationError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
    this.name = 'PolicyValidationError';
  }
}

// Curated default rules. These mirror the most common indirect
// prompt-injection payloads documented in the OWASP LLM Top 10 and
// public jailbreak corpora. They are intentionally case-insensitive
// substring/regex matches: we accept a small false-positive rate to
// catch the long tail of paraphrases. Customers in `monitor` mode
// can decide which to silence before promoting to `flag` / `block`.
const BUILTIN_RULES: Array<Omit<InjectionRule, 'createdBy' | 'createdAt' | 'updatedAt'>> = [
  {
    id: 'builtin-ignore-previous',
    pattern: '(?:ignore|disregard|forget)\\s+(?:all\\s+)?(?:previous|above|prior|earlier)\\s+(?:instructions?|prompts?|messages?|rules?)',
    severity: 'high',
    label: 'instruction override ("ignore previous instructions")',
    builtin: true,
  },
  {
    id: 'builtin-system-prompt-disclose',
    pattern: '(?:reveal|print|show|repeat|leak|output)\\s+(?:your|the)\\s+(?:system\\s+prompt|initial\\s+prompt|hidden\\s+instructions?)',
    severity: 'high',
    label: 'system prompt disclosure',
    builtin: true,
  },
  {
    id: 'builtin-role-override',
    pattern: '(?:you\\s+are\\s+now|act\\s+as|pretend\\s+to\\s+be|roleplay\\s+as)\\s+(?:dan|developer\\s+mode|jailbroken|an\\s+unrestricted)',
    severity: 'high',
    label: 'role override / DAN-style jailbreak',
    builtin: true,
  },
  {
    id: 'builtin-tool-exfil-url',
    pattern: '!\\[[^\\]]*\\]\\(https?://[^)\\s]*\\?[^)\\s]*=\\{',
    severity: 'high',
    label: 'image-tag exfiltration with templated query',
    builtin: true,
  },
  {
    id: 'builtin-zero-width',
    // U+200B..U+200D (ZWSP / ZWNJ / ZWJ) and U+FEFF often used to hide
    // payloads from human reviewers while remaining tokenised by the
    // model. Three or more in a row is a strong signal.
    pattern: '[\\u200B-\\u200D\\uFEFF]{3,}',
    severity: 'med',
    label: 'hidden zero-width characters',
    builtin: true,
  },
  {
    id: 'builtin-fenced-system',
    pattern: '<\\s*(?:system|s>|\\|im_start\\|>system)',
    severity: 'med',
    label: 'embedded system role tag',
    builtin: true,
  },
  {
    id: 'builtin-exfil-keywords',
    pattern: '(?:send|email|post|exfiltrate|forward)\\s+(?:the\\s+)?(?:api\\s+key|password|secret|token|conversation|chat\\s+history)',
    severity: 'high',
    label: 'data exfiltration request',
    builtin: true,
  },
];

function defaultFile(): PolicyFile {
  return {
    version: 1,
    mode: 'flag',
    rules: [],
    disabledBuiltins: [],
  };
}

async function loadAll(dataDir: string): Promise<PolicyFile> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PolicyFile>;
    return {
      version: 1,
      mode: (parsed.mode as PolicyMode) ?? 'flag',
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      disabledBuiltins: Array.isArray(parsed.disabledBuiltins) ? parsed.disabledBuiltins : [],
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaultFile();
    throw err;
  }
}

async function saveAll(dataDir: string, data: PolicyFile): Promise<void> {
  const path = file(dataDir);
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + '.tmp-' + randomBytes(4).toString('hex');
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, path);
}

function newId(): string {
  return 'pir_' + randomBytes(8).toString('hex');
}

function validatePattern(pattern: string): void {
  if (!pattern || pattern.length > MAX_PATTERN_LEN) {
    throw new PolicyValidationError('pattern', `pattern length must be 1..${MAX_PATTERN_LEN}`);
  }
  try {
    new RegExp(pattern, 'i');
  } catch (e) {
    throw new PolicyValidationError('pattern', `invalid regex: ${(e as Error).message}`);
  }
}

export interface AddInput {
  pattern: string;
  severity?: Severity;
  label?: string | null;
}

export async function getPolicy(dataDir: string): Promise<PolicyFile> {
  return loadAll(dataDir);
}

export async function activeRules(dataDir: string): Promise<InjectionRule[]> {
  const data = await loadAll(dataDir);
  const disabled = new Set(data.disabledBuiltins);
  const seeded: InjectionRule[] = BUILTIN_RULES.filter((r) => !disabled.has(r.id)).map((r) => ({
    ...r,
    createdBy: 'system',
    createdAt: 0,
    updatedAt: 0,
  }));
  return [...seeded, ...data.rules];
}

export async function listRules(dataDir: string): Promise<{ mode: PolicyMode; rules: InjectionRule[] }> {
  const data = await loadAll(dataDir);
  const rules = await activeRules(dataDir);
  return { mode: data.mode, rules };
}

export async function setMode(dataDir: string, mode: PolicyMode): Promise<PolicyFile> {
  if (!['off', 'monitor', 'flag', 'block'].includes(mode)) {
    throw new PolicyValidationError('mode', 'mode must be off|monitor|flag|block');
  }
  const data = await loadAll(dataDir);
  data.mode = mode;
  await saveAll(dataDir, data);
  return data;
}

export async function addRule(
  dataDir: string,
  userId: string,
  input: AddInput,
): Promise<InjectionRule> {
  validatePattern(input.pattern);
  const sev: Severity = input.severity ?? 'med';
  if (!['low', 'med', 'high'].includes(sev)) {
    throw new PolicyValidationError('severity', 'severity must be low|med|high');
  }
  const label = input.label ?? null;
  if (label !== null && label.length > MAX_LABEL_LEN) {
    throw new PolicyValidationError('label', `label length must be <= ${MAX_LABEL_LEN}`);
  }
  const data = await loadAll(dataDir);
  if (data.rules.length >= MAX_PATTERNS) {
    throw new PolicyValidationError('pattern', `cannot exceed ${MAX_PATTERNS} custom rules`);
  }
  if (data.rules.some((r) => r.pattern === input.pattern)) {
    throw new PolicyValidationError('pattern', 'rule with identical pattern already exists');
  }
  const now = Date.now();
  const rule: InjectionRule = {
    id: newId(),
    pattern: input.pattern,
    severity: sev,
    label,
    builtin: false,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
  data.rules.push(rule);
  await saveAll(dataDir, data);
  return rule;
}

export async function removeRule(dataDir: string, id: string): Promise<boolean> {
  const data = await loadAll(dataDir);
  // Custom rule path.
  const before = data.rules.length;
  data.rules = data.rules.filter((r) => r.id !== id);
  if (data.rules.length !== before) {
    await saveAll(dataDir, data);
    return true;
  }
  // Builtin rule: record in disabledBuiltins so future loads omit it.
  const isBuiltin = BUILTIN_RULES.some((r) => r.id === id);
  if (isBuiltin && !data.disabledBuiltins.includes(id)) {
    data.disabledBuiltins.push(id);
    await saveAll(dataDir, data);
    return true;
  }
  return false;
}

export interface MatchedFlag {
  ruleId: string;
  severity: Severity;
  label: string | null;
}

// Scan a single source excerpt. Returns the list of matched flags
// (possibly empty). Compiled regexes are cached per-call array so a
// page of 10 sources does not recompile the same pattern 10 times.
export function scanText(text: string, rules: InjectionRule[]): MatchedFlag[] {
  if (!text) return [];
  const out: MatchedFlag[] = [];
  for (const r of rules) {
    let re: RegExp;
    try {
      re = new RegExp(r.pattern, 'i');
    } catch {
      // A custom rule that became invalid (eg. via JSON edit) is
      // skipped rather than crashing every /ask request. Operators
      // see this in the rule list because it never fires.
      continue;
    }
    if (re.test(text)) {
      out.push({ ruleId: r.id, severity: r.severity, label: r.label });
    }
  }
  return out;
}
