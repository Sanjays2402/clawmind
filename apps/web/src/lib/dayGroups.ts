// Group a time-ordered list into per-day buckets with friendly headers.
//
// The /history list is a flat stream of answers newest-first. Grouping the
// rows under a small date header ("Today", "Yesterday", "Monday", or a full
// date for older items) lets the eye scan by when a question was asked rather
// than counting rows. Kept pure + dependency-free so it's trivial to reason
// about and reuse (the conversations list could adopt the same buckets later).

/** Local midnight (ms) for a timestamp — the bucket key for a calendar day. */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * A human label for a day bucket relative to `now`:
 *   - today        -> "Today"
 *   - yesterday    -> "Yesterday"
 *   - same week    -> weekday name ("Monday")
 *   - same year    -> "Mar 4"
 *   - older        -> "Mar 4, 2025"
 */
export function dayLabel(dayStart: number, now: Date = new Date()): string {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const oneDay = 86_400_000;
  const diffDays = Math.round((todayMs - dayStart) / oneDay);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  const d = new Date(dayStart);
  // Within the last 7 days (but not today/yesterday): show the weekday.
  if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }
  // Same calendar year: drop the year for a tighter header.
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export interface DayGroup<T> {
  /** Local-midnight ms key for the day. */
  dayStart: number;
  /** Friendly header label resolved at grouping time. */
  label: string;
  items: T[];
}

/**
 * Bucket `items` into day groups, preserving the input order both across and
 * within groups. The caller is responsible for sorting (the history API
 * already returns newest-first); this only partitions, it does not reorder, so
 * a newest-first input yields newest-first groups each holding newest-first
 * rows. A day with no items never produces an empty group.
 */
export function groupByDay<T>(
  items: T[],
  getTs: (item: T) => number,
  now: Date = new Date(),
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  let current: DayGroup<T> | null = null;
  for (const item of items) {
    const key = startOfDay(getTs(item));
    if (!current || current.dayStart !== key) {
      current = { dayStart: key, label: dayLabel(key, now), items: [item] };
      groups.push(current);
    } else {
      current.items.push(item);
    }
  }
  return groups;
}
