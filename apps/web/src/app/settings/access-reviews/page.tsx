'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { TopNav } from '@/components/TopNav';
import {
  api,
  fmtRelative,
  ApiError,
  type AccessReview,
  type AccessReviewItem,
  type AccessReviewSummary,
  type MemberRole,
  type ReviewDecision,
} from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconShield,
  IconUsers,
  IconCheck,
  IconWarning,
  IconTrash,
  IconArrowRight,
  IconPlus,
} from '@clawmind/ui';

// Periodic access reviews. SOC2 CC6.3 and ISO 27001 A.9.2.5 both expect
// a formal recertification cadence; this page is the owner-facing UI
// that produces the audit-trail artifact reviewers ask for.

const DECISION_LABEL: Record<ReviewDecision, string> = {
  pending: 'Pending',
  keep: 'Keep',
  downgrade: 'Downgrade',
  revoke: 'Revoke',
};

const ROLE_RANK: Record<MemberRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };

function explainError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Sign in to use access reviews.';
    if (err.status === 403) return 'Owner role required.';
    if (err.status === 412) return 'MFA step-up required. Verify a second factor and retry.';
    const body = err.body as { error?: string; message?: string } | null;
    return body?.message || body?.error || err.message;
  }
  return err instanceof Error ? err.message : 'Unexpected error.';
}

export default function AccessReviewsPage() {
  const [reviews, setReviews] = useState<AccessReview[] | null>(null);
  const [summary, setSummary] = useState<AccessReviewSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<AccessReview | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [attestation, setAttestation] = useState('');
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState(false);

  const refresh = useCallback(async (selectId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const [list, sum] = await Promise.all([api.accessReviewsList(), api.accessReviewsSummary()]);
      setReviews(list);
      setSummary(sum);
      const target = selectId
        ? list.find((r) => r.id === selectId)
        : (active ? list.find((r) => r.id === active.id) : list.find((r) => r.status === 'open'));
      setActive(target ?? null);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onOpen = useCallback(async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const r = await api.accessReviewsOpen(newTitle.trim());
      setNewTitle('');
      await refresh(r.id);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setCreating(false);
    }
  }, [newTitle, refresh]);

  const onDecide = useCallback(async (
    userId: string,
    decision: 'keep' | 'downgrade' | 'revoke',
    downgradeTo?: MemberRole,
  ) => {
    if (!active) return;
    setBusyUserId(userId);
    setError(null);
    try {
      const r = await api.accessReviewsDecide(active.id, userId, {
        decision,
        downgradeTo: decision === 'downgrade' ? downgradeTo ?? 'viewer' : null,
      });
      setActive(r);
      setReviews((prev) => prev?.map((x) => (x.id === r.id ? r : x)) ?? null);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusyUserId(null);
    }
  }, [active]);

  const onClose = useCallback(async () => {
    if (!active) return;
    if (!confirm(
      'Closing applies every downgrade and revoke decision immediately. ' +
      'This cannot be undone. Continue?',
    )) return;
    setClosing(true);
    setError(null);
    try {
      const res = await api.accessReviewsClose(active.id, attestation.trim() || null);
      setAttestation('');
      await refresh(res.review.id);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setClosing(false);
    }
  }, [active, attestation, refresh]);

  const pendingCount = useMemo(
    () => active?.items.filter((i) => i.decision === 'pending').length ?? 0,
    [active],
  );

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-muted p-2 text-foreground">
              <IconShield size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Access reviews</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Periodic recertification of who has access. Open a campaign, decide every
                member, attest, and close. Required by SOC2 CC6.3 and ISO 27001 A.9.2.5.
              </p>
            </div>
          </div>
          {summary && (
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <Stat label="Open" value={summary.open} />
              <Stat label="Closed" value={summary.closed} />
              <Stat
                label="Last close"
                value={summary.daysSinceLastClose === null ? '-' : `${summary.daysSinceLastClose}d`}
              />
            </div>
          )}
        </header>

        {error && <div className="mb-6"><ErrorState title="Something went wrong" message={error} /></div>}

        {loading && !reviews && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Loading reviews</div>
        )}

        {/* New review */}
        <section className="mb-8 rounded-lg border border-border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-medium">Open a new review</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Snapshots every current member. Decisions you record below are applied when you close.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. 2026 Q2 access review"
              maxLength={200}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={onOpen}
              disabled={creating || !newTitle.trim()}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              {creating ? <Spinner /> : <IconPlus size={16} />}
              Open review
            </button>
          </div>
        </section>

        {/* Reviews list */}
        {reviews && reviews.length === 0 && !loading && (
          <EmptyState
            icon={<IconUsers size={28} />}
            title="No access reviews yet"
            body="Open your first review above to start recording recertifications."
          />
        )}

        {reviews && reviews.length > 0 && (
          <section className="grid gap-6 lg:grid-cols-[260px,1fr]">
            <aside className="space-y-2">
              <h2 className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Reviews
              </h2>
              <ul className="space-y-1">
                {reviews.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => setActive(r)}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                        active?.id === r.id
                          ? 'border-foreground bg-muted'
                          : 'border-border bg-card hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{r.title}</span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            r.status === 'open'
                              ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
                              : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200'
                          }`}
                        >
                          {r.status}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Opened {fmtRelative(r.openedAt)} · {r.items.length} members
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>

            <div className="min-w-0">
              {active ? <ReviewDetail
                review={active}
                pendingCount={pendingCount}
                busyUserId={busyUserId}
                onDecide={onDecide}
                attestation={attestation}
                onAttestation={setAttestation}
                onClose={onClose}
                closing={closing}
              /> : (
                <EmptyState
                  icon={<IconArrowRight size={24} />}
                  title="Pick a review"
                  body="Choose a review from the list to walk through decisions."
                />
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

interface DetailProps {
  review: AccessReview;
  pendingCount: number;
  busyUserId: string | null;
  onDecide: (userId: string, decision: 'keep' | 'downgrade' | 'revoke', downgradeTo?: MemberRole) => void;
  attestation: string;
  onAttestation: (v: string) => void;
  onClose: () => void;
  closing: boolean;
}

function ReviewDetail({ review, pendingCount, busyUserId, onDecide, attestation, onAttestation, onClose, closing }: DetailProps) {
  const isClosed = review.status === 'closed';
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{review.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Opened by <span className="font-mono">{review.openedBy}</span> {fmtRelative(review.openedAt)}
              {isClosed && review.closedBy && (
                <> · Closed by <span className="font-mono">{review.closedBy}</span> {fmtRelative(review.closedAt)}</>
              )}
            </p>
          </div>
          {!isClosed && (
            <span className="rounded-full bg-muted px-3 py-1 text-xs">
              {pendingCount} pending · {review.items.length - pendingCount} decided
            </span>
          )}
        </div>
        {isClosed && review.attestation && (
          <div className="mt-3 rounded-md border border-border bg-background p-3 text-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Attestation</div>
            <div className="mt-1 whitespace-pre-wrap">{review.attestation}</div>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Member</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Last seen</th>
              <th className="px-3 py-2 font-medium">Decision</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {review.items.map((item) => (
              <Row
                key={item.userId}
                item={item}
                disabled={isClosed || busyUserId === item.userId}
                onDecide={(d, to) => onDecide(item.userId, d, to)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {!isClosed && (
        <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
          <h3 className="text-sm font-medium">Close and attest</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Closing applies every downgrade and revoke decision immediately and signs your
            attestation into the audit log. All {review.items.length} members must have a
            decision before close is allowed.
          </p>
          <textarea
            value={attestation}
            onChange={(e) => onAttestation(e.target.value)}
            placeholder="I attest that I have reviewed every member's access and the decisions above are correct."
            maxLength={1000}
            rows={3}
            className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {pendingCount > 0
                ? <span className="inline-flex items-center gap-1"><IconWarning size={14} /> {pendingCount} pending</span>
                : <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><IconCheck size={14} /> All decided</span>}
            </div>
            <button
              onClick={onClose}
              disabled={pendingCount > 0 || closing}
              className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              {closing ? <Spinner /> : <IconCheck size={16} />}
              Close review
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  item,
  disabled,
  onDecide,
}: {
  item: AccessReviewItem;
  disabled: boolean;
  onDecide: (decision: 'keep' | 'downgrade' | 'revoke', downgradeTo?: MemberRole) => void;
}) {
  const downgradeOptions: MemberRole[] = item.snapshotRole === 'owner' || item.snapshotRole === 'admin'
    ? (['member', 'viewer'] as MemberRole[]).filter((r) => ROLE_RANK[r] < ROLE_RANK[item.snapshotRole])
    : (['viewer'] as MemberRole[]).filter((r) => ROLE_RANK[r] < ROLE_RANK[item.snapshotRole]);
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2">
        <div className="font-mono text-xs">{item.userId}</div>
        {(item.label || item.email) && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {item.label || item.email}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-xs capitalize">{item.snapshotRole}</td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{fmtRelative(item.snapshotLastSeenAt)}</td>
      <td className="px-3 py-2 text-xs">
        <DecisionBadge item={item} />
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap justify-end gap-1">
          <ActionButton
            label="Keep"
            icon={<IconCheck size={13} />}
            active={item.decision === 'keep'}
            disabled={disabled}
            onClick={() => onDecide('keep')}
          />
          {downgradeOptions.length > 0 && (
            <select
              disabled={disabled}
              value={item.decision === 'downgrade' && item.downgradeTo ? item.downgradeTo : ''}
              onChange={(e) => {
                const v = e.target.value as MemberRole | '';
                if (v) onDecide('downgrade', v);
              }}
              className={`rounded-md border px-2 py-1 text-xs ${
                item.decision === 'downgrade'
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/30'
                  : 'border-border bg-background'
              } disabled:opacity-50`}
              aria-label="Downgrade to"
            >
              <option value="">Downgrade…</option>
              {downgradeOptions.map((r) => (
                <option key={r} value={r}>to {r}</option>
              ))}
            </select>
          )}
          <ActionButton
            label="Revoke"
            icon={<IconTrash size={13} />}
            active={item.decision === 'revoke'}
            danger
            disabled={disabled}
            onClick={() => onDecide('revoke')}
          />
        </div>
      </td>
    </tr>
  );
}

function DecisionBadge({ item }: { item: AccessReviewItem }) {
  const map: Record<ReviewDecision, string> = {
    pending: 'bg-muted text-muted-foreground',
    keep: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200',
    downgrade: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
    revoke: 'bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200',
  };
  let label: string = DECISION_LABEL[item.decision];
  if (item.decision === 'downgrade' && item.downgradeTo) label += ` to ${item.downgradeTo}`;
  return (
    <div className="space-y-1">
      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${map[item.decision]}`}>
        {label}
      </span>
      {item.appliedAction && item.appliedAction !== 'none' && (
        <div className="text-[10px] text-muted-foreground">
          Applied: {item.appliedAction}
          {item.appliedError ? ` — ${item.appliedError}` : ''}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  label, icon, active, danger, disabled, onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  danger?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const base = 'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition disabled:opacity-50';
  const tone = danger
    ? active
      ? 'border-rose-500 bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200'
      : 'border-border bg-background hover:bg-rose-50 dark:hover:bg-rose-900/20'
    : active
      ? 'border-emerald-500 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200'
      : 'border-border bg-background hover:bg-muted';
  return (
    <button type="button" className={`${base} ${tone}`} disabled={disabled} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}
