import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Workspace Model Allowlist.
//
// Owner-managed policy controlling which LLM model identifiers may be
// used to answer requests in the workspace. Enforced AFTER the LLM
// returns its model tag (so a provider-override or fallback that
// silently switches to a non-approved model is caught and rejected
// before the answer is written to history or fanned out to webhooks).
//
// Procurement teams ask for this because:
//
//   1. Data residency. Some models are hosted in regions the customer
//      has not approved (US-only deals where a fallback would otherwise
//      reach an EU/AP region, or vice versa).
//   2. Vendor risk. A new model from an unreviewed provider must not
//      automatically inherit production traffic just because someone
//      flipped a router env var in CI.
//   3. Compliance. Regulated industries (health, legal, finance) need
//      to demonstrate that only models on the approved subprocessor
//      list ever produce answers users see.
//
// Modes:
//   * disabled  policy is off; every model is accepted (default).
//   * allow     only listed model ids are accepted.
//   * block     every model is accepted EXCEPT the listed ids.
//
// On-disk layout: <dataDir>/model-allowlist.json. Atomic tmp+rename.
// Single workspace per deployment, matching every other policy file.

export const MAX_MODELS = 100;
export const MAX_MODEL_ID_LEN = 200;
export const MAX_LABEL_LEN = 120;

export type AllowlistMode = 'disabled' | 'allow' | 'block';

export interface ModelRule {
  id: string;
  model: string;
  label: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface ModelAllowlistFile {
  version: 1;
  mode: AllowlistMode;
  models: ModelRule[];
  updatedBy: string | null;
  updatedAt: number;
}

const FILE = 'model-allowlist.json';

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

export class AllowlistValidationError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
    this.name = 'AllowlistValidationError';
  }
}

export function emptyFile(): ModelAllowlistFile {
  return {
    version: 1,
    mode: 'disabled',
    models: [],
    updatedBy: null,
    updatedAt: 0,
  };
}

async function loadAll(dataDir: string): Promise<ModelAllowlistFile> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ModelAllowlistFile>;
    if (!parsed || parsed.version !== 1) return emptyFile();
    const mode: AllowlistMode =
      parsed.mode === 'allow' || parsed.mode === 'block' ? parsed.mode : 'disabled';
    const models = Array.isArray(parsed.models)
      ? parsed.models.filter((m): m is ModelRule => !!m && typeof m.model === 'string')
      : [];
    return {
      version: 1,
      mode,
      models,
      updatedBy: typeof parsed.updatedBy === 'string' ? parsed.updatedBy : null,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyFile();
    throw err;
  }
}

async function saveAll(dataDir: string, data: ModelAllowlistFile): Promise<void> {
  const target = file(dataDir);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, target);
}

export async function getPolicy(dataDir: string): Promise<ModelAllowlistFile> {
  return loadAll(dataDir);
}

export interface SetModeInput {
  mode: AllowlistMode;
}

export async function setMode(
  dataDir: string,
  userId: string,
  input: SetModeInput,
): Promise<ModelAllowlistFile> {
  if (
    input.mode !== 'disabled' &&
    input.mode !== 'allow' &&
    input.mode !== 'block'
  ) {
    throw new AllowlistValidationError('mode', 'mode must be disabled, allow, or block');
  }
  const cur = await loadAll(dataDir);
  cur.mode = input.mode;
  cur.updatedBy = userId;
  cur.updatedAt = Date.now();
  await saveAll(dataDir, cur);
  return cur;
}

export interface AddRuleInput {
  model: string;
  label?: string | null;
}

function normaliseModel(s: string): string {
  return s.trim();
}

export async function addRule(
  dataDir: string,
  userId: string,
  input: AddRuleInput,
): Promise<ModelRule> {
  const model = normaliseModel(input.model);
  if (!model) {
    throw new AllowlistValidationError('model', 'model id is required');
  }
  if (model.length > MAX_MODEL_ID_LEN) {
    throw new AllowlistValidationError(
      'model',
      `model id must be at most ${MAX_MODEL_ID_LEN} characters`,
    );
  }
  const label =
    input.label == null || input.label === ''
      ? null
      : String(input.label).slice(0, MAX_LABEL_LEN);
  const cur = await loadAll(dataDir);
  if (cur.models.length >= MAX_MODELS) {
    throw new AllowlistValidationError(
      'models',
      `at most ${MAX_MODELS} models may be configured`,
    );
  }
  if (cur.models.some((m) => m.model.toLowerCase() === model.toLowerCase())) {
    throw new AllowlistValidationError('model', 'model is already configured');
  }
  const now = Date.now();
  const rule: ModelRule = {
    id: randomBytes(8).toString('hex'),
    model,
    label,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
  cur.models.push(rule);
  cur.updatedBy = userId;
  cur.updatedAt = now;
  await saveAll(dataDir, cur);
  return rule;
}

export async function removeRule(
  dataDir: string,
  ruleId: string,
): Promise<ModelRule | null> {
  const cur = await loadAll(dataDir);
  const idx = cur.models.findIndex((m) => m.id === ruleId);
  if (idx === -1) return null;
  const removed = cur.models.splice(idx, 1)[0]!;
  cur.updatedAt = Date.now();
  await saveAll(dataDir, cur);
  return removed;
}

export interface ModelDecision {
  allowed: boolean;
  mode: AllowlistMode;
  matched: ModelRule | null;
}

// Pure evaluator. Used by the gate at request time AND by tests.
export function evaluate(file: ModelAllowlistFile, model: string): ModelDecision {
  if (file.mode === 'disabled') {
    return { allowed: true, mode: 'disabled', matched: null };
  }
  const want = model.toLowerCase();
  const found = file.models.find((m) => m.model.toLowerCase() === want);
  const match: ModelRule | null = found === undefined ? null : found;
  if (file.mode === 'allow') {
    return { allowed: !!match, mode: 'allow', matched: match };
  }
  // block mode
  return { allowed: !match, mode: 'block', matched: match };
}
