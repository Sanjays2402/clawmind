# clawmind autoship STATE

Cron-owned memory for the 20-minute autoship loop. Maintained by Cake (cron)
on the feature/autoship branch. Sanjay reviews and merges manually.

- Branch: `feature/autoship` (cut from `main` 2026-06-20).
- Cron identity: `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.
- Verify gate: `pnpm run ci:verify` (typecheck + test + build across all packages).
- Quality bar: each item is a small, demo-able vertical slice. Tests for new
  behaviour. No drive-by refactors. No emoji in commit messages.

## Active focus

CLI usability + reliability. The API surface has had a heavy compliance push
recently (security posture, breach register, key allowlists, etc.) and the
`apps/cli` surface is the user-facing seam that's been lagging on:
1. Consistent "API unreachable" / non-2xx error handling across every command.
2. JSON / scripting ergonomics (`--json`, `--paths`, `--tsv`, `--out`,
   `--paths-only`) for piping into other tools.
3. Filter / shape options (`--top`, `--sort`, `--threshold`, `-q`) so the
   operator doesn't have to post-process with `jq` for the common cases.
4. Small affordances that show up in Sanjay's day-to-day (filters, latency
   hints, exit codes).

## Roadmap (newest first - work top to bottom each tick)

Status legend: [ ] open, [x] done, [~] in-progress (only ever during a single tick).

### Tick 2026-06-20 12:27 PDT (current)

- [x] feat(pins): add --paths flag to pins list for pipeline-friendly output (e91c76d)
- [x] feat(mutes): add --paths flag to mutes list for pipeline-friendly output (7c84163)
- [x] feat(aliases): add --paths flag to aliases list for pipeline-friendly output (28cd9c6)
- [x] feat(search): add --no-snippet to emit slim ranking-only JSON (2645a6b)
- [x] feat(search): read the query from stdin when the argument is "-" (8538749)

### Tick 2026-06-20 08:05 PDT

- [x] feat(stats): add --top <n> to cap per-namespace extension breakdown (c47bc78)
- [x] feat(stats): add --sort <files|chunks|bytes|namespace> for the per-namespace table (77e0d9a)
- [x] feat(stats): add --tsv mode mirroring stale --tsv for awk/cut pipelines (2146dcb)
- [x] feat(search): add -t/--threshold to drop hits below a relevance score (6a7327b)
- [x] feat(forget): add --paths-only to emit just the matched paths (dd00423)

### Tick 2026-06-20 04:25 PDT

- [x] fix(deps): pin vitest to ^2.1.9 to restore vite 5 compatibility (3010d31)
- [x] fix(stale): surface clean error when api is unreachable or returns error body (aedb504)
- [x] feat(stale): add --tsv option to emit tab-separated rows for piping (7e1f329)
- [x] fix(forget): surface clean error when api is unreachable or returns error body (c6be7ae)
- [x] fix(stats): surface clean error when api is unreachable or returns error body (f9d7948)
- [x] feat(status): show resolved api base url and per-probe latency (46d1151)
- [x] fix(cli/compact): drop duplicate dryRun key in --json output (1c57284)

### Queued for later ticks

- [ ] fix(telemetry): bump @opentelemetry/resources to ^2.0.0 + adapt tracing.ts to the new resourceFromAttributes API (the exporter and auto-instrumentations also need version bumps to clear all peer warnings — pre-existing typecheck red, NOT caused by any cron feature; ci:verify cannot pass until this is resolved)
- [ ] feat(tags): add --paths-only to tags paths to drop styling and emit one path per line (currently it does that in text mode but a flag makes the contract explicit)
- [ ] feat(ask): add --no-citations flag for quick non-cited answers
- [ ] feat(ask): add --out option mirroring search --out for saving long answers
- [ ] feat(ask): add --threshold to require a minimum citation score (skip llm when no citation clears the bar)
- [ ] feat(digest): add -q substring filter to digest *show* history rows (digest list already has -q)
- [ ] feat(digest): add --since <iso-date> to digest show to bound the history window
- [ ] feat(watch): add --debounce <ms> option to coalesce rapid file events
- [ ] feat(watch): print a one-line startup banner to stderr (kind=banner, ts) so log scrapers can spot a restart
- [ ] feat(doctor): add --severity <warn|error> to filter the displayed findings list (always exits non-zero on error regardless)
- [ ] feat(doctor): add --staleAfterDays <n> CLI flag that forwards to the API's staleAfterMs override
- [ ] feat(status): add --watch <ms> to repoll periodically for terminal dashboards
- [ ] feat(status): add --check to exit non-zero when any probe (embed/llm) is down (CI smoke check)
- [ ] feat(stats): add --since <iso-date> to filter namespaces whose newestIngestedAt is older than the cutoff
- [ ] feat(stats): add --json compact mode (single-line JSON instead of pretty-printed, easier to diff)
- [ ] feat(feedback): add --json filter to list returning only paths above/below a boost multiplier
- [ ] feat(reindex): add --dry-run that lists files that would be reindexed without touching the store
- [ ] feat(ingest): add --since <iso-date> to only ingest files modified after the cutoff (incremental refresh from cron)
- [ ] feat(forget): add --confirm <count> safety prompt: refuse --apply when the match count exceeds N unless --confirm matches the actual count (prevents accidental whole-index wipes)
- [ ] feat(search): add --paths-only as a one-shot path dump (`clawmind search foo --paths-only` -> one path per line for shell loops)
- [ ] feat(ask): add --stream-json to emit one NDJSON event per token (kind=token/sources/done) for live UI piping
- [ ] feat(status): add --json-watch that emits one NDJSON snapshot per poll cycle (pairs with --watch)
- [ ] feat(pins/mutes): add --paths --since <iso> filter so cron snapshots only export recently-touched entries

## Conventions

- Every CLI fetch helper should wrap the fetch in a single ApiError-style class
  and a per-command label that prefixes both the transport error ("cannot
  reach ...") and the non-2xx error ("foo failed (503 ...): <body>").
- Tests live next to the command file in `apps/cli/test/<name>.test.ts` and
  use the `globalThis.fetch` stub pattern from `doctor.test.ts` /
  `aliases.test.ts`.
- Keep `--json` output stable across non-error paths so downstream scripts
  can pipe with `jq` without conditional handling.
- Pipeline-friendly modes (`--paths`, `--paths-only`, `--tsv`) MUST emit
  with no ANSI styling and no headers so `cut`/`awk`/`xargs` work without
  conditional skips. Pin the exact byte layout in tests.

## Tick log

(updated by each tick at the bottom)

- 2026-06-20 04:25 PDT (Cake/cron) — 7 features shipped on feature/autoship.
  Bootstrap: 561f1fb. Features: 3010d31, aedb504, 7e1f329, c6be7ae, f9d7948,
  46d1151, 1c57284. Test gate: `@clawmind/cli` 70/70 vitest pass after the
  vitest pin (was completely broken on main). Typecheck: every package
  green EXCEPT `@clawmind/telemetry` which has a pre-existing OpenTelemetry
  1.x/2.x peer mismatch (queued for next tick). Compact.ts TS2783 that was
  silently red on main is now fixed.

- 2026-06-20 08:05 PDT (Cake/cron) — 5 features shipped on feature/autoship.
  Features: c47bc78, 77e0d9a, 2146dcb, 6a7327b, dd00423. Test gate:
  `@clawmind/cli` 94/94 vitest pass (up from 70). Typecheck: `@clawmind/cli`
  green, telemetry pre-existing red unchanged (confirmed by running typecheck
  on packages/telemetry both before and after the batch — identical error,
  not introduced by anything in this batch). All five focus the same theme:
  scripting ergonomics. stats grew --top/--sort/--tsv so the namespace
  breakdown is finally pipeline-friendly without `jq`; search grew
  -t/--threshold to push the relevance floor into the command; forget grew
  --paths-only to mirror stale --paths and complete the pipeline `clawmind
  stale --paths | xargs -n1 clawmind forget --apply`.

- 2026-06-20 12:27 PDT (Cake/cron) — 5 features shipped on feature/autoship.
  Features: e91c76d, 7c84163, 28cd9c6, 2645a6b, 8538749. Test gate:
  `@clawmind/cli` 113/113 vitest pass (up from 94). 19 net new tests
  spread across 5 files: pins.test.ts (new, 4), mutes.test.ts (new, 4),
  aliases.test.ts (+2), search.test.ts (+5 stdin and +4 --no-snippet).
  Typecheck: same pre-existing telemetry/declaration-file pattern (chai
  duplicate identifiers + ts target downlevel + kleur esModuleInterop)
  unchanged; no new errors introduced.
  Theme: round out the `--paths` pipeline contract that started with
  stale --paths and forget --paths-only. pins/mutes/aliases all grew the
  same `--paths` flag (one path per line, no styling, no headers, no
  notes/reasons/timestamps; zero matches yields an empty stream). This
  makes a whole new class of one-liner real:
    clawmind pins list --paths -q stale | xargs -n1 clawmind forget --apply
    clawmind aliases list --paths -q work | xargs ls -la
  search grew `--no-snippet` (drops snippet/highlights from the --json
  payload so rerank/eval pipelines get an order-of-magnitude smaller
  shape) and stdin support (`clawmind search -` reads the query from
  stdin so `echo foo | clawmind search -` works in shell loops without
  argv quoting). Stdin mode rejects the empty stream loudly so an
  accidental `cmd | clawmind search -` upstream-empty does NOT
  silently dump the index.
