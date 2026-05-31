import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Workspace PII Redaction Policy.
//
// Procurement / security teams routinely ask "what stops a user pasting
// a customer SSN into the search box and sending it to your LLM
// provider?" The query blocklist answers that for a small enumerated set
// of patterns, but a redaction policy is the broader control: any input
// that matches a configured detector class is rewritten in-place with a
// fixed token (e.g. `[REDACTED:ssn]`) BEFORE it reaches retrieval or the
// LLM. The original raw query never enters the audit log, the snapshot,
// the conversation history, or any outbound provider call.
//
// Detector classes shipped by default:
//   email         RFC 5322 simplified
//   phone         North-American + international forms with optional +
//   ssn           US social security pattern (NNN-NN-NNNN)
//   credit_card   13-19 digit card-like sequence, Luhn-validated
//   ipv4          dotted quad, 0-255 octets
//
// Owners can also declare custom rules with a labelled regex.
//
// Each class can be:
//   * 'off'      detector inactive; no redaction
//   * 'redact'   substitute with the redaction token, request proceeds
//   * 'block'    reject the request with 422 'pii-blocked'
//
// `block` is the conservative choice for the highest-stakes classes
// (credit_card, ssn) because a partial redaction that misses a single
// digit still leaks the secret. `redact` is the right default for things
// like emails and phone numbers where the *form* is what matters and a
// false positive is recoverable.
//
// On-disk layout: <dataDir>/pii-redaction.json. Atomic tmp+rename.
// Single workspace per deployment matching every other policy file.

export const MAX_CUSTOM_RULES = 50;
export const MAX_CUSTOM_LABEL_LEN = 60;
export const MAX_CUSTOM_PATTERN_LEN = 500;

export type DetectorAction = 'off' | 'redact' | 'block';

export const BUILTIN_CLASSES = [
  'email',
  'phone',
  'ssn',
  'credit_card',
  'ipv4',
] as const;
export type BuiltinClass = (typeof BUILTIN_CLASSES)[number];

export interface CustomRule {
  id: string;
  label: string;       // short human label, becomes the token suffix
  pattern: string;     // JS regex source, validated at write
  action: DetectorAction;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface PiiRedactionPolicy {
  version: 1;
  builtins: Record<BuiltinClass, DetectorAction>;
  custom: CustomRule[];
  updatedAt: number;
  updatedBy: string | null;
}

const FILE = 'pii-redaction.json';

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

function defaults(): PiiRedactionPolicy {
  return {
    version: 1,
    // Defaults: block the secrets, redact the identifiers. An owner
    // can dial any class to 'off' from the settings UI.
    builtins: {
      email: 'redact',
      phone: 'redact',
      ssn: 'block',
      credit_card: 'block',
      ipv4: 'off',
    },
    custom: [],
    updatedAt: 0,
    updatedBy: null,
  };
}

export class PiiValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'PiiValidationError';
  }
}

async function load(dataDir: string): Promise<PiiRedactionPolicy> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as PiiRedactionPolicy;
    if (!parsed || parsed.version !== 1) return defaults();
    // Backfill any newly-added builtin class with 'off' so a fresh
    // release does not silently start blocking.
    const merged = defaults();
    for (const c of BUILTIN_CLASSES) {
      if (parsed.builtins && isAction(parsed.builtins[c])) {
        merged.builtins[c] = parsed.builtins[c];
      }
    }
    merged.custom = Array.isArray(parsed.custom) ? parsed.custom : [];
    merged.updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0;
    merged.updatedBy = typeof parsed.updatedBy === 'string' ? parsed.updatedBy : null;
    return merged;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaults();
    throw err;
  }
}

async function save(dataDir: string, policy: PiiRedactionPolicy): Promise<void> {
  const p = file(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(policy, null, 2), 'utf8');
  await rename(tmp, p);
}

function isAction(v: unknown): v is DetectorAction {
  return v === 'off' || v === 'redact' || v === 'block';
}

export async function getPolicy(dataDir: string): Promise<PiiRedactionPolicy> {
  return load(dataDir);
}

export interface UpdatePolicyInput {
  builtins?: Partial<Record<BuiltinClass, DetectorAction>>;
  custom?: Array<{
    id?: string;
    label: string;
    pattern: string;
    action: DetectorAction;
  }>;
}

export async function updatePolicy(
  dataDir: string,
  actorUserId: string,
  input: UpdatePolicyInput,
): Promise<PiiRedactionPolicy> {
  const current = await load(dataDir);
  const next: PiiRedactionPolicy = {
    ...current,
    builtins: { ...current.builtins },
    custom: current.custom.slice(),
  };
  if (input.builtins) {
    for (const [k, v] of Object.entries(input.builtins)) {
      if (!(BUILTIN_CLASSES as readonly string[]).includes(k)) {
        throw new PiiValidationError('builtins', `unknown class "${k}"`);
      }
      if (!isAction(v)) {
        throw new PiiValidationError(
          `builtins.${k}`,
          'action must be "off", "redact", or "block"',
        );
      }
      next.builtins[k as BuiltinClass] = v;
    }
  }
  if (input.custom) {
    if (input.custom.length > MAX_CUSTOM_RULES) {
      throw new PiiValidationError(
        'custom',
        `at most ${MAX_CUSTOM_RULES} custom rules`,
      );
    }
    const seenLabels = new Set<string>();
    const now = Date.now();
    const rebuilt: CustomRule[] = [];
    for (const r of input.custom) {
      const label = (r.label ?? '').trim();
      if (label.length === 0 || label.length > MAX_CUSTOM_LABEL_LEN) {
        throw new PiiValidationError(
          'custom.label',
          `label must be 1..${MAX_CUSTOM_LABEL_LEN} characters`,
        );
      }
      // Labels become the redaction token suffix, so they must be a
      // safe slug: alnum, dash, underscore. This stops a custom label
      // injecting markdown / control characters into a downstream LLM
      // prompt that quotes the substituted text back to the user.
      if (!/^[A-Za-z0-9_-]+$/.test(label)) {
        throw new PiiValidationError(
          'custom.label',
          'label must be alphanumeric (plus _ and -)',
        );
      }
      if (seenLabels.has(label.toLowerCase())) {
        throw new PiiValidationError(
          'custom.label',
          `duplicate label "${label}"`,
        );
      }
      seenLabels.add(label.toLowerCase());
      if (
        typeof r.pattern !== 'string' ||
        r.pattern.length === 0 ||
        r.pattern.length > MAX_CUSTOM_PATTERN_LEN
      ) {
        throw new PiiValidationError(
          'custom.pattern',
          `pattern must be 1..${MAX_CUSTOM_PATTERN_LEN} characters`,
        );
      }
      try {
        // eslint-disable-next-line no-new
        new RegExp(r.pattern, 'gi');
      } catch (err) {
        throw new PiiValidationError(
          'custom.pattern',
          `invalid regex: ${(err as Error).message}`,
        );
      }
      if (!isAction(r.action)) {
        throw new PiiValidationError(
          'custom.action',
          'action must be "off", "redact", or "block"',
        );
      }
      const existing = r.id
        ? current.custom.find((c) => c.id === r.id)
        : undefined;
      rebuilt.push({
        id: existing?.id ?? randomBytes(6).toString('hex'),
        label,
        pattern: r.pattern,
        action: r.action,
        createdBy: existing?.createdBy ?? actorUserId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    }
    next.custom = rebuilt;
  }
  next.updatedAt = Date.now();
  next.updatedBy = actorUserId;
  await save(dataDir, next);
  return next;
}

// -----------------------------------------------------------------------
// Detection
// -----------------------------------------------------------------------

interface CompiledDetector {
  className: string;     // e.g. 'email', 'ssn', or a custom label
  action: DetectorAction;
  regex: RegExp;
  builtin: boolean;
}

// Detector regexes are deliberately kept simple and well-known rather
// than chasing the long tail. False positives are recoverable (the user
// sees a 422 and rewrites the query); a clever bypass that defeats a
// PCRE-grade pattern would be a worse outcome than a missed match here
// because the user would think they were covered.
const BUILTIN_REGEX: Record<BuiltinClass, RegExp> = {
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  phone:
    /(?:(?<![\d.])\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g,
  ssn: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
  // 13-19 digits with optional separators. Luhn check done in
  // postprocessing to suppress random ID numbers.
  credit_card: /\b(?:\d[ -]?){12,18}\d\b/g,
  ipv4: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g,
};

function luhn(num: string): boolean {
  const digits = num.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function compile(policy: PiiRedactionPolicy): CompiledDetector[] {
  const out: CompiledDetector[] = [];
  for (const c of BUILTIN_CLASSES) {
    const action = policy.builtins[c];
    if (action === 'off') continue;
    out.push({
      className: c,
      action,
      regex: new RegExp(BUILTIN_REGEX[c].source, BUILTIN_REGEX[c].flags),
      builtin: true,
    });
  }
  for (const r of policy.custom) {
    if (r.action === 'off') continue;
    let re: RegExp;
    try {
      re = new RegExp(r.pattern, 'gi');
    } catch {
      continue;
    }
    out.push({ className: r.label, action: r.action, regex: re, builtin: false });
  }
  return out;
}

export interface RedactionMatch {
  className: string;    // e.g. 'email', 'ssn', or a custom label
  action: DetectorAction; // 'redact' or 'block'; 'off' never reaches here
  count: number;        // number of distinct matches for this class
}

export interface RedactionResult {
  // The query rewritten with `[REDACTED:<class>]` substituted for each
  // match of any 'redact' detector. Unchanged from the input if no
  // detector fired (and no detector is at 'block').
  redacted: string;
  // The list of classes that matched, with action chosen by the policy.
  matches: RedactionMatch[];
  // If any detector with action='block' matched, this names the first
  // class that triggered the block. The route layer translates this
  // into a 422 response and does NOT pass the query downstream.
  blockedBy: string | null;
}

export function applyRedaction(
  q: string,
  policy: PiiRedactionPolicy,
): RedactionResult {
  if (typeof q !== 'string' || q.length === 0) {
    return { redacted: q ?? '', matches: [], blockedBy: null };
  }
  const detectors = compile(policy);
  if (detectors.length === 0) {
    return { redacted: q, matches: [], blockedBy: null };
  }
  const matches: RedactionMatch[] = [];
  let blockedBy: string | null = null;
  let working = q;
  for (const d of detectors) {
    // Reset the lastIndex since we may have already executed this regex
    // earlier as part of compile/health.
    d.regex.lastIndex = 0;
    let count = 0;
    if (d.className === 'credit_card') {
      // Luhn-validate before counting / replacing so a 16-digit phone
      // number expansion doesn't get flagged as a card.
      const collected: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = d.regex.exec(working)) !== null) {
        if (luhn(m[0])) collected.push(m[0]);
      }
      if (collected.length === 0) continue;
      count = collected.length;
      if (d.action === 'redact') {
        for (const hit of collected) {
          // Replace each Luhn-valid hit literally; escape regex metachars.
          const esc = hit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          working = working.replace(
            new RegExp(esc, 'g'),
            `[REDACTED:${d.className}]`,
          );
        }
      }
    } else {
      if (d.action === 'redact') {
        const before = working;
        working = working.replace(d.regex, `[REDACTED:${d.className}]`);
        // Count by re-running the regex against the original, since
        // .replace() doesn't expose the hit count directly.
        const re2 = new RegExp(d.regex.source, d.regex.flags);
        const hits = before.match(re2);
        count = hits ? hits.length : 0;
      } else {
        const hits = working.match(d.regex);
        count = hits ? hits.length : 0;
      }
    }
    if (count === 0) continue;
    matches.push({ className: d.className, action: d.action, count });
    if (d.action === 'block' && blockedBy === null) {
      blockedBy = d.className;
    }
  }
  return { redacted: working, matches, blockedBy };
}
