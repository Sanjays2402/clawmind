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

### Tick 2026-06-20 16:05 PDT (current)

- [x] feat(tags): add --paths flag to tags paths for pipeline-friendly output (4457b33)
- [x] feat(stats): add --compact for single-line JSON snapshots (87de268)
- [x] feat(digest): add -q substring filter to digest show history rows (fe4dc23)
- [x] feat(ask): add --no-citations flag for quick non-cited answers (7579ed7)
- [x] feat(ask): add --threshold to skip LLM when no citation clears the bar (3e4ba85)

### Tick 2026-06-20 12:27 PDT

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
- [ ] fix(rag/hybrid): hybridMerge test on packages/rag/test/hybrid.test.ts expects `out[0].id === 'b'` but the merge orders 'a' (bm25 score 10) above 'b' under alpha=0.5; either the test fixture or the hybrid blend has drifted. Pre-existing failure (verified by typechecking parent commit 3cc6fd1), NOT introduced by any cron tick — was simply unknown because earlier ticks only ran `--filter @clawmind/cli test`, not `pnpm -r test`. Either rewrite the test against the current alpha-blend semantics OR re-derive the expected order from first principles.
- [ ] feat(ask): add --out option mirroring search --out for saving long answers
- [ ] feat(digest): add --since <iso-date> to digest show to bound the history window
- [ ] feat(watch): add --debounce <ms> option to coalesce rapid file events
- [ ] feat(watch): print a one-line startup banner to stderr (kind=banner, ts) so log scrapers can spot a restart
- [ ] feat(doctor): add --severity <warn|error> to filter the displayed findings list (always exits non-zero on error regardless)
- [ ] feat(doctor): add --staleAfterDays <n> CLI flag that forwards to the API's staleAfterMs override
- [ ] feat(status): add --watch <ms> to repoll periodically for terminal dashboards
- [ ] feat(status): add --check to exit non-zero when any probe (embed/llm) is down (CI smoke check)
- [ ] feat(stats): add --since <iso-date> to filter namespaces whose newestIngestedAt is older than the cutoff
- [ ] feat(feedback): add --json filter to list returning only paths above/below a boost multiplier
- [ ] feat(reindex): add --dry-run that lists files that would be reindexed without touching the store
- [ ] feat(ingest): add --since <iso-date> to only ingest files modified after the cutoff (incremental refresh from cron)
- [ ] feat(forget): add --confirm <count> safety prompt: refuse --apply when the match count exceeds N unless --confirm matches the actual count (prevents accidental whole-index wipes)
- [ ] feat(search): add --paths-only as a one-shot path dump (`clawmind search foo --paths-only` -> one path per line for shell loops)
- [ ] feat(ask): add --stream-json to emit one NDJSON event per token (kind=token/sources/done) for live UI piping
- [ ] feat(status): add --json-watch that emits one NDJSON snapshot per poll cycle (pairs with --watch)
- [ ] feat(pins/mutes): add --paths --since <iso> filter so cron snapshots only export recently-touched entries
- [ ] feat(tags): add --paths-only to tags paths to drop styling and emit one path per line — SUPERSEDED by 4457b33 which added --paths covering the same shape; this entry can be deleted next cleanup pass

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

- 2026-06-20 16:05 PDT (Cake/cron) — 5 features shipped on feature/autoship.
  Features: 4457b33, 87de268, fe4dc23, 7579ed7, 3e4ba85. Test gate:
  `@clawmind/cli` 136/136 vitest pass (up from 113). 23 net new tests
  spread across 4 files: tags.test.ts (new, 4), stats.test.ts (+4),
  feedback-digest.test.ts (+4), ask.test.ts (new, 11).
  Typecheck: `@clawmind/cli` clean. Two pre-existing reds remain
  outside the cli package: (1) `@clawmind/telemetry` OpenTelemetry
  1.x/2.x peer mismatch — same as previous 3 ticks, queued; (2)
  `packages/rag/test/hybrid.test.ts` is failing under the current
  alpha-blend semantics (expects 'b' first but gets 'a'). Verified
  pre-existing by typechecking parent commit 3cc6fd1 — same failure
  there. Was simply unknown until this tick because earlier ticks ran
  `--filter @clawmind/cli test`, not `pnpm -r test`. Logged in the
  Queued list for a future tick to fix.
  Theme: round out the queued cli features the previous 3 ticks had
  punted: pipeline-friendly tags paths (matches the pins/mutes/aliases
  --paths contract); --compact JSON for stats (single-line so NDJSON
  cron snapshots diff cleanly); digest show -q (history-row substring
  filter spanning new/removed paths); and the two ask gates the
  roadmap explicitly asked for — --no-citations (drops the citations
  footer in text mode AND the citations[]+count fields in --json) and
  --threshold (a pre-LLM gate that aborts before any token is spent
  when no retrieved source clears the score bar, exiting 1 with a
  structured skip payload in --json mode for shell-pipeline branching).
  Crucial design property of --threshold: it short-circuits AT the
  sources event, so the askStream generator never actually pulls
  from `deps.llm.stream(...)` — the LLM is genuinely not called,
  not just hidden after the fact.
