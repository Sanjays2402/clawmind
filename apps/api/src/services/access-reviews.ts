import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { listMembers, removeMember, updateRole, type MemberRecord, type MemberRole } from './members.js';

// Periodic access reviews (a.k.a. user access recertification) are a hard
// requirement of SOC2 CC6.3, ISO 27001 A.9.2.5, and most enterprise
// procurement reviews ("how often do you re-certify who has access?").
//
// Workflow:
//   1. An owner OPENS a review campaign. We snapshot every current member
//      (userId, role, email, label, lastSeenAt) so the decision is bound
//      to who held what role at review time, not who happens to exist
//      when the review eventually completes.
//   2. The owner walks the list and records a per-member DECISION:
//        keep        - access remains as-is.
//        downgrade   - role is lowered (to member or viewer).
//        revoke      - member is removed from the workspace.
//      Each decision carries an optional note.
//   3. Closing the review applies any pending downgrade/revoke decisions
//      atomically, writes one audit record per applied change, and
//      stamps the review as completed with the closing actor's userId
//      acting as the attestation signature. After close, the review is
//      immutable - it is the regulator-facing artifact.
//
// On-disk layout: <dataDir>/access-reviews.json, atomic rewrite. We keep
// every review forever because the whole point is to produce a long-tail
// paper trail; deletion would defeat the audit purpose.

export const REVIEW_DECISIONS = ['pending', 'keep', 'downgrade', 'revoke'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const REVIEW_STATUSES = ['open', 'closed'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const MAX_NOTE_LEN = 1000;

export interface ReviewItem {
  userId: string;
  /** Role the member held when the review was opened. */
  snapshotRole: MemberRole;
  email: string | null;
  label: string | null;
  /** lastSeenAt at review open time, ms epoch, or null if never seen. */
  snapshotLastSeenAt: number | null;
  decision: ReviewDecision;
  /** Required when decision === 'downgrade'. */
  downgradeTo: MemberRole | null;
  note: string | null;
  decidedBy: string | null;
  decidedAt: number | null;
  /** What we actually did when the review closed; null if not yet closed
   * or if the decision was 'keep' / 'pending'. */
  appliedAction: 'none' | 'downgraded' | 'revoked' | 'skipped-missing' | 'skipped-last-owner' | null;
  appliedError: string | null;
}

export interface ReviewRecord {
  id: string;
  title: string;
  status: ReviewStatus;
  openedBy: string;
  openedAt: number;
  closedBy: string | null;
  closedAt: number | null;
  /** Free-form attestation text the closer enters on close. */
  attestation: string | null;
  items: ReviewItem[];
}

interface ReviewFile {
  version: 1;
  reviews: ReviewRecord[];
}

function reviewsPath(dataDir: string): string {
  return join(dataDir, 'access-reviews.json');
}

async function readFileSafe(dataDir: string): Promise<ReviewFile> {
  try {
    const raw = await readFile(reviewsPath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as ReviewFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.reviews)) {
      return { version: 1, reviews: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, reviews: [] };
    }
    throw err;
  }
}

async function writeFileSafe(dataDir: string, file: ReviewFile): Promise<void> {
  const p = reviewsPath(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  await rename(tmp, p);
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

export async function listReviews(dataDir: string): Promise<ReviewRecord[]> {
  const file = await readFileSafe(dataDir);
  // Newest first - reviewers typically resume the most recent open one.
  return [...file.reviews].sort((a, b) => b.openedAt - a.openedAt);
}

export async function getReview(dataDir: string, id: string): Promise<ReviewRecord | null> {
  const file = await readFileSafe(dataDir);
  return file.reviews.find((r) => r.id === id) ?? null;
}

export interface OpenReviewInput {
  title: string;
  openedBy: string;
}

export async function openReview(
  dataDir: string,
  input: OpenReviewInput,
): Promise<ReviewRecord> {
  const members = await listMembers(dataDir);
  const items: ReviewItem[] = members.map((m: MemberRecord) => ({
    userId: m.userId,
    snapshotRole: m.role,
    email: m.email,
    label: m.label,
    snapshotLastSeenAt: m.lastSeenAt,
    decision: 'pending',
    downgradeTo: null,
    note: null,
    decidedBy: null,
    decidedAt: null,
    appliedAction: null,
    appliedError: null,
  }));
  const rec: ReviewRecord = {
    id: randomUUID(),
    title: clip(input.title.trim() || 'Access review', 200),
    status: 'open',
    openedBy: input.openedBy,
    openedAt: Date.now(),
    closedBy: null,
    closedAt: null,
    attestation: null,
    items,
  };
  const file = await readFileSafe(dataDir);
  file.reviews.push(rec);
  await writeFileSafe(dataDir, file);
  return rec;
}

export type DecideError =
  | { ok: false; code: 'not-found' }
  | { ok: false; code: 'closed' }
  | { ok: false; code: 'item-not-found' }
  | { ok: false; code: 'downgrade-required-target' }
  | { ok: false; code: 'invalid-downgrade-target' };

export type DecideResult =
  | { ok: true; review: ReviewRecord }
  | DecideError;

export interface DecideInput {
  decision: Exclude<ReviewDecision, 'pending'>;
  downgradeTo?: MemberRole | null;
  note?: string | null;
  decidedBy: string;
}

export async function setDecision(
  dataDir: string,
  reviewId: string,
  userId: string,
  input: DecideInput,
): Promise<DecideResult> {
  const file = await readFileSafe(dataDir);
  const review = file.reviews.find((r) => r.id === reviewId);
  if (!review) return { ok: false, code: 'not-found' };
  if (review.status !== 'open') return { ok: false, code: 'closed' };
  const item = review.items.find((i) => i.userId === userId);
  if (!item) return { ok: false, code: 'item-not-found' };
  if (input.decision === 'downgrade') {
    if (!input.downgradeTo) return { ok: false, code: 'downgrade-required-target' };
    // Cannot "downgrade" to owner or admin (that's promotion) and not
    // to the same role the member already holds at snapshot time.
    if (input.downgradeTo !== 'member' && input.downgradeTo !== 'viewer') {
      return { ok: false, code: 'invalid-downgrade-target' };
    }
  }
  item.decision = input.decision;
  item.downgradeTo = input.decision === 'downgrade' ? (input.downgradeTo ?? null) : null;
  item.note = input.note ? clip(input.note, MAX_NOTE_LEN) : null;
  item.decidedBy = input.decidedBy;
  item.decidedAt = Date.now();
  await writeFileSafe(dataDir, file);
  return { ok: true, review };
}

export type CloseError =
  | { ok: false; code: 'not-found' }
  | { ok: false; code: 'already-closed' }
  | { ok: false; code: 'pending-decisions'; pending: string[] };

export interface AppliedChange {
  userId: string;
  action: NonNullable<ReviewItem['appliedAction']>;
  error: string | null;
}

export type CloseResult =
  | { ok: true; review: ReviewRecord; applied: AppliedChange[] }
  | CloseError;

export interface CloseInput {
  closedBy: string;
  /** Role of the closing actor, used to gate downgrade/revoke targets
   * through the existing members.ts hierarchy rules. */
  closerRole: MemberRole;
  attestation: string | null;
}

// Close a review. Walks every item:
//   - pending  : refuse the close; the operator must decide every row
//                so we have a complete recertification record.
//   - keep     : no-op, recorded as appliedAction='none'.
//   - downgrade: call updateRole. Last-owner / hierarchy errors are
//                captured into appliedError but do NOT abort the close
//                because partial application is the realistic outcome
//                when the registry has shifted between open and close.
//   - revoke   : call removeMember with the same caveats.
export async function closeReview(
  dataDir: string,
  reviewId: string,
  input: CloseInput,
): Promise<CloseResult> {
  const file = await readFileSafe(dataDir);
  const review = file.reviews.find((r) => r.id === reviewId);
  if (!review) return { ok: false, code: 'not-found' };
  if (review.status !== 'open') return { ok: false, code: 'already-closed' };
  const pending = review.items.filter((i) => i.decision === 'pending').map((i) => i.userId);
  if (pending.length > 0) return { ok: false, code: 'pending-decisions', pending };

  const applied: AppliedChange[] = [];
  for (const item of review.items) {
    if (item.decision === 'keep') {
      item.appliedAction = 'none';
      item.appliedError = null;
      continue;
    }
    if (item.decision === 'downgrade' && item.downgradeTo) {
      const r = await updateRole(dataDir, item.userId, item.downgradeTo, {
        userId: input.closedBy,
        role: input.closerRole,
      });
      if (r.ok) {
        item.appliedAction = 'downgraded';
        item.appliedError = null;
      } else if (r.code === 'not-found') {
        item.appliedAction = 'skipped-missing';
        item.appliedError = 'member no longer exists';
      } else if (r.code === 'last-owner') {
        item.appliedAction = 'skipped-last-owner';
        item.appliedError = 'cannot demote the last owner';
      } else {
        item.appliedAction = 'skipped-missing';
        item.appliedError = (r as { message?: string }).message ?? r.code;
      }
      applied.push({ userId: item.userId, action: item.appliedAction!, error: item.appliedError });
      continue;
    }
    if (item.decision === 'revoke') {
      const r = await removeMember(dataDir, item.userId, {
        userId: input.closedBy,
        role: input.closerRole,
      });
      if (r.ok) {
        item.appliedAction = 'revoked';
        item.appliedError = null;
      } else if (r.code === 'not-found') {
        item.appliedAction = 'skipped-missing';
        item.appliedError = 'member no longer exists';
      } else if (r.code === 'last-owner') {
        item.appliedAction = 'skipped-last-owner';
        item.appliedError = 'cannot revoke the last owner';
      } else {
        item.appliedAction = 'skipped-missing';
        item.appliedError = (r as { message?: string }).message ?? r.code;
      }
      applied.push({ userId: item.userId, action: item.appliedAction!, error: item.appliedError });
    }
  }
  review.status = 'closed';
  review.closedBy = input.closedBy;
  review.closedAt = Date.now();
  review.attestation = input.attestation ? clip(input.attestation, MAX_NOTE_LEN) : null;
  await writeFileSafe(dataDir, file);
  return { ok: true, review, applied };
}

export interface ReviewSummary {
  total: number;
  open: number;
  closed: number;
  /** ms since the most recent CLOSED review; null if none ever. */
  daysSinceLastClose: number | null;
}

export async function summarise(dataDir: string): Promise<ReviewSummary> {
  const file = await readFileSafe(dataDir);
  let open = 0, closed = 0, lastClose = 0;
  for (const r of file.reviews) {
    if (r.status === 'open') open++;
    else {
      closed++;
      if (r.closedAt && r.closedAt > lastClose) lastClose = r.closedAt;
    }
  }
  const days = lastClose ? Math.floor((Date.now() - lastClose) / (24 * 60 * 60 * 1000)) : null;
  return { total: file.reviews.length, open, closed, daysSinceLastClose: days };
}
