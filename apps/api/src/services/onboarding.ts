import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// Per-user onboarding state. Tracks which of the three first-run steps the
// user has completed so the /welcome page can resume in the right place and
// the home page can stop nagging once the user is set up.
//
// Steps are deliberately small and concrete so each one delivers an
// immediate "I made the product do something" moment:
//   1. ingest      ingested at least one source (sample pack or own dir)
//   2. ask         ran their first /ask query
//   3. configure   either issued an API key, created a saved search,
//                  or set up a webhook (whichever they tried first)
//
// We persist as a flat JSON map keyed by user id so a single read on app
// boot is enough to render the home page without an extra DB round-trip
// per request.

export const ONBOARDING_STEPS = ['ingest', 'ask', 'configure'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingRecord {
  userId: string;
  steps: Partial<Record<OnboardingStep, number>>; // step -> completedAt ms
  dismissed: boolean;
  createdAt: number;
  updatedAt: number;
}

export type OnboardingMap = Record<string, OnboardingRecord>;

function file(dataDir: string) {
  return join(dataDir, 'onboarding.json');
}

export async function loadAll(dataDir: string): Promise<OnboardingMap> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    return JSON.parse(raw) as OnboardingMap;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function saveAll(dataDir: string, map: OnboardingMap) {
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(map, null, 2));
}

function empty(userId: string): OnboardingRecord {
  const now = Date.now();
  return { userId, steps: {}, dismissed: false, createdAt: now, updatedAt: now };
}

export async function getRecord(dataDir: string, userId: string): Promise<OnboardingRecord> {
  const map = await loadAll(dataDir);
  return map[userId] ?? empty(userId);
}

export async function completeStep(
  dataDir: string,
  userId: string,
  step: OnboardingStep,
): Promise<OnboardingRecord> {
  const map = await loadAll(dataDir);
  const rec = map[userId] ?? empty(userId);
  if (rec.steps[step] == null) {
    rec.steps[step] = Date.now();
  }
  rec.updatedAt = Date.now();
  map[userId] = rec;
  await saveAll(dataDir, map);
  return rec;
}

export async function setDismissed(
  dataDir: string,
  userId: string,
  dismissed: boolean,
): Promise<OnboardingRecord> {
  const map = await loadAll(dataDir);
  const rec = map[userId] ?? empty(userId);
  rec.dismissed = dismissed;
  rec.updatedAt = Date.now();
  map[userId] = rec;
  await saveAll(dataDir, map);
  return rec;
}

export function progress(rec: OnboardingRecord): {
  completed: OnboardingStep[];
  next: OnboardingStep | null;
  total: number;
  done: number;
} {
  const completed = ONBOARDING_STEPS.filter((s) => rec.steps[s] != null);
  const next = ONBOARDING_STEPS.find((s) => rec.steps[s] == null) ?? null;
  return {
    completed,
    next,
    total: ONBOARDING_STEPS.length,
    done: completed.length,
  };
}
