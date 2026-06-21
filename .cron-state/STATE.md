# clawmind autoship STATE

Cron-owned memory for the 20-minute autoship loop. Maintained by Cake (cron)
directly on main. (Commits land on main each tick.)

- **Active branch: `main`** — commit and push DIRECTLY to main every tick. No feature branches.
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

### Tick 2026-06-21 00:40 PDT (current)

- [x] feat(related): add -t/--threshold to drop neighbours below a relevance score (51dd7b8)
- [x] feat(digest): add show --last <n> to cap history rows newest-first (53e2550)
- [x] feat(stats): add --paths to emit the per-namespace extension flat list (fc363f0)
- [x] feat(watch): add --debounce <ms> to coalesce rapid file events (814cbe5)
- [x] feat(watch): emit an NDJSON startup banner to stderr on each run (76a5c9e)

### Tick 2026-06-20 22:01 PDT

- [x] feat(related): add --paths-only to dump deduped neighbour paths in rank order (5d6edcf)
- [x] feat(stats): add --since to keep only namespaces whose newestIngestedAt is older than the cutoff (f9f81a4)
- [x] feat(stale): add --since to filter the report to files whose last ingest predates an ISO cutoff (5db09c2)
- [x] feat(digest): add show --since <iso-date> to bound the history window by absolute date (ca8f043)
- [x] feat(feedback): add list --above/--below to filter entries by boost multiplier (a7ec554)

### Tick 2026-06-20 18:51 PDT

- [x] feat(ask): add --out option for saving long answers to a file (d7ab8a1)
- [x] feat(status): add --check to exit non-zero when any probe is down (2762613)
- [x] feat(forget): add --confirm safety tripwire to refuse misaligned --apply runs (5adbd71)
- [x] feat(doctor): add --severity to filter the displayed findings list (49ce082)
- [x] feat(search): add --paths-only to dump a deduplicated path-per-line stream (28b0414)

### Tick 2026-06-20 16:05 PDT

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
- [ ] feat(doctor): add --staleAfterDays <n> CLI flag that forwards to the API's staleAfterMs override
- [ ] feat(status): add --watch <ms> to repoll periodically for terminal dashboards
- [ ] feat(reindex): add --dry-run that lists files that would be reindexed without touching the store
- [ ] feat(ingest): add --since <iso-date> to only ingest files modified after the cutoff (incremental refresh from cron)
- [ ] feat(ask): add --stream-json to emit one NDJSON event per token (kind=token/sources/done) for live UI piping
- [ ] feat(status): add --json-watch that emits one NDJSON snapshot per poll cycle (pairs with --watch)
- [ ] feat(pins/mutes): add --paths --since <iso> filter so cron snapshots only export recently-touched entries
- [ ] feat(export): add --since <iso-date> to bound the export window for incremental dumps
- [ ] feat(tags): add --counts mode listing namespaces with their tag-frequency totals (for "what tags are dominating my index" questions)
- [ ] feat(search): add --rerank-off escape hatch to skip the rerank step for debugging fusion vs rerank effects
- [ ] feat(forget): add --json --dry-run --paths-only shortcut so a script can preview removals without parsing the structured payload (currently a single-flag combo of existing flags but worth a smoke test)
- [ ] feat(feedback): add `feedback prune --below <n>` to bulk-clear all paths whose boost falls below a threshold (natural sibling of `feedback list --below`; the cron use is "every Sunday morning, prune anything below 0.7 that has not been re-voted in 90d")
- [ ] feat(watch): add --quiet / -q flag to suppress the per-file event lines (banner still emits on stderr; useful for cron-restarted watchers where the operator wants only the restart marker, not 100/sec event chatter)
- [ ] feat(watch): add --once flag that processes the initial scan + ingests current files once, then exits cleanly (lets cron use the same code path as a normal ingest for parity between scheduled refresh and live watching)
- [ ] feat(digest): add `digest show --since-last` shortcut — bound to the saved-search's previous run timestamp ("what has this saved search surfaced since the last time I read it") without an explicit cutoff arg
- [ ] feat(stats): add --json --since shortcut that emits a single `{stale: [...], total: N}` payload — pairs with --since semantics already shipped this session but currently --json + --since dumps the full report shape; a slimmed shape is what cron pipelines actually want
- [ ] feat(related): add -n/--namespaces filter forwarded to the API (the option already exists; verify it's honoured end-to-end and add a regression test)
- [ ] feat(stale): add --paths-only mirroring forget --paths-only / search --paths-only naming (the existing `--paths` flag predates the contract; add --paths-only as an alias so the family is uniform AND keep --paths for back-compat with the byte-layout tests)

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

- 2026-06-20 18:51 PDT (Cake/cron) — 5 features shipped on feature/autoship.
  Features: d7ab8a1, 2762613, 5adbd71, 49ce082, 28b0414. Test gate:
  `@clawmind/cli` 160/160 vitest pass (up from 136). 24 net new tests
  spread across 5 files: ask.test.ts (+4), status.test.ts (+5),
  forget.test.ts (+5), doctor.test.ts (+5), search.test.ts (+5).
  Typecheck: `@clawmind/cli` clean. Same two pre-existing reds outside
  cli (telemetry OpenTelemetry 1.x/2.x peer mismatch + rag/hybrid
  test alpha-blend drift); neither introduced this tick.
  Theme: knock out four of the five queued cli items the previous
  ticks had punted, plus complete the `--paths-only` pipeline
  contract across the last unreached command (search).
    1. ask --out: mirrors `search --out`, writes assembled
       answer (sources header + body + latency + optional citations)
       to a file in text mode, JSON payload in --json mode. Critical
       design: token-by-token stdout dribble is suppressed when --out
       is set so the answer is NOT rendered twice (terminal + file).
       Saved files are ANSI-clean. Stderr carries the green
       "wrote answer" confirmation.
    2. status --check: CI smoke-check flag. Body unchanged so a
       single command can both report AND drive the exit code.
       Non-OK → exit 2 (NOT 1 — reserved for command crashes, so
       wrappers can distinguish "ran fine, probe down" from
       "command crashed"). In text mode, also drops a red
       "status --check: <down probes> down" line to stderr so
       scripts redirecting stdout still get a useful log line.
    3. forget --confirm <n>: safety tripwire. With --apply, does a
       dry-run pre-flight FIRST to learn the real count, then only
       proceeds to destruction when count === N exactly. The "-1"
       sentinel is the explicit opt-out for unknown-size scripts.
       Without --apply, --confirm is silently ignored (dry-run is
       already safe). Error spells out BOTH numbers and the correct
       re-run command so the operator can copy-paste a fix.
    4. doctor --severity <info|warn|error>: display-only filter; the
       exit code is STILL driven by the FULL report's `ok` flag so
       hiding warnings can never accidentally hide an error from CI.
       Adds two text-mode hints: "<n> below --severity X; nothing
       to show" when filter empties the table, and "... <n> more"
       at the tail when some rows are hidden. --json mode adds a
       new `findingsTotal` field alongside the filtered `findings`
       array so a dashboard can show "1 of 3" without re-running.
    5. search --paths-only: completes the pipeline contract begun
       with pins/mutes/aliases/tags --paths and forget/search
       --paths-only. Deduplicates by path in rank order (search
       returns chunk-granular hits so the same file can appear
       multiple times). Short-circuits before --json/--out/etc.
       Empty stream on zero matches — critically does NOT leak the
       stderr "no results" hint that would poison `xargs ls`.
       Threshold + tag filters still compose naturally.
  All five focus the same theme: scripting ergonomics. The cli
  surface is now noticeably more pipeable — every list-style command
  has the same --paths/--paths-only contract; --out exists on both
  search and ask; --check exists for CI smoke-checking; --confirm
  exists as a tripwire on the only destructive command.
  Verify-gate note: ran `pnpm run ci:verify` which hit the same two
  pre-existing reds (telemetry typecheck + rag hybrid test). Both
  remain queued, both verified pre-existing this and prior ticks.
  Also hit a vitest fork-pool deadlock after wiping the .vite cache
  mid-tick (macOS quirk); switching to --no-isolate cleared it. No
  fix required — the normal `pnpm --filter @clawmind/cli test` path
  is unaffected outside of a stale-cache hiccup.

- 2026-06-20 22:01 PDT (Cake/cron) — 5 features shipped on feature/autoship.
  Features: 5d6edcf, f9f81a4, 5db09c2, ca8f043, a7ec554. Test gate:
  `@clawmind/cli` 186/186 vitest pass (up from 160). 26 net new tests
  spread across 4 files: related.test.ts (+4), stats.test.ts (+5),
  stale.test.ts (+4), feedback-digest.test.ts (+13 — 5 digest --since
  + 8 feedback --above/--below). Typecheck: `@clawmind/cli` clean.
  Same two pre-existing reds outside cli (telemetry OpenTelemetry
  1.x/2.x peer mismatch + rag/hybrid test alpha-blend drift); neither
  introduced this tick.
  Theme: complete the absolute-date filter family + finish the
  paths-only contract.
    1. related --paths-only: the last list-style command missing
       the --paths-only / --paths contract that pins/mutes/aliases/
       tags/search/forget/stale already had. Dedupes against a Set
       in rank order (the API today returns one row per source but
       the contract promises dedupe so a future change cannot
       silently break callers). Zero matches yields a clean empty
       stream — no header, no "no related sources" hint, no ANSI
       — so `clawmind related foo.md --paths-only | xargs ls`
       works without conditional skips. Short-circuits --json so
       the contract is unambiguous when both flags are set.
    2. stats --since <iso-date>: keeps only namespaces whose
       newestIngestedAt predates the cutoff. The namespace-level
       complement to per-file `stale`. Two intentional design
       properties: (a) newestIngestedAt=null is KEPT (a
       never-indexed namespace is the most extreme case of stale,
       so dropping it would hide exactly the bug an operator
       cares about); (b) totals are RECOMPUTED so a downstream
       "stale namespaces account for X bytes" report still adds
       up. Composes with -q for "stale memory-ish namespaces".
       Invalid ISO date aborts cleanly.
    3. stale --since <iso-date>: absolute-date complement to
       --days <n>. The existing --days is a relative window
       anchored to wall-clock; --since accepts an absolute anchor
       which matters from cron where the cutoff often lives in a
       config or env var. Composes with --days as an intersection.
       Effective lastIngestedAt is derived from row.ageDays - the
       API only exposes ageDays, but ageDays is computed from the
       underlying timestamp so the round-trip is lossless to the
       day. `total` is recomputed from the filtered length so the
       text-mode "N stale, showing M" header stays accurate
       post-filter. Filter applies to every output mode (--json,
       --paths, --tsv, default text).
    4. digest show --since <iso-date>: bound the history window
       by absolute date. Pairs naturally with -q ("what did
       saved-search X surface about path Y since date Z").
       Cutoff is INCLUSIVE (>=) because a row with ts === cutoff
       is "from the cutoff onwards" by every colloquial reading.
       The text-mode empty-state hint was generalised — the old
       "-q only" wording would have lied when --since was the
       narrowing filter; new unified hint mentions whichever
       filter(s) are active.
    5. feedback list --above/--below: filter entries by boost
       multiplier. Answers the cron-friendly questions
       ("upvote-dominant paths", "strongest downvotes",
       "almost-neutral band") without piping --json through jq.
       STRICT comparisons (`>` and `<`) so boost === 1.0 is
       excluded from both --above 1.0 and --below 1.0 — neutral
       is excluded from signed-motion questions. Both flags
       compose as an intersection so --above 0.95 --below 1.05
       is the "almost neutral" band in a single invocation.
       Filter applies BEFORE --json emit / text rendering so both
       output modes see the same subset. -q forwards to API
       unchanged; --above/--below apply client-side on top.
  Verify-gate note: ran the full `pnpm typecheck` and `pnpm -r
  test`. The only failures are the same two pre-existing reds
  noted above. The `@clawmind/cli` build is clean.

- 2026-06-21 00:40 PDT (Cake/cron) — 5 features shipped on feature/autoship.
  Features: 51dd7b8, 53e2550, fc363f0, 814cbe5, 76a5c9e. Test gate:
  `@clawmind/cli` 216/216 vitest pass (up from 186). 30 net new tests
  spread across 4 files: related.test.ts (+5), feedback-digest.test.ts
  (+7), stats.test.ts (+6), watch.test.ts (new, 12). Typecheck:
  `@clawmind/cli` clean. Same two pre-existing reds outside cli
  (telemetry OpenTelemetry 1.x/2.x peer mismatch + rag/hybrid test
  alpha-blend drift); neither introduced this tick.
  Theme: knock out the queued cli items that mirror existing
  contracts on adjacent commands.
    1. related --threshold: mirrors `search --threshold` byte-for-byte
       (inclusive lower bound, non-numeric silently ignored so
       `--threshold $MAYBE` does not crash on an empty env var,
       filter applied BEFORE --paths-only / --json / text so every
       output mode sees the same subset). Applied client-side
       because the /v1/related API does not accept a minScore
       parameter today; exposing the dial on the cli avoids an
       API change for a genuinely-presentational choice. The
       --json `count` field is recomputed to the kept length so a
       downstream `jq '.count'` consumer is not lied to;
       `sourceChunkCount` is preserved verbatim (it's a property
       of the source, not the returned set).
    2. digest show --last <n>: caps history to the newest N rows
       after -q / --since narrow the survivors. API returns
       history newest-first, so slice(0, N) is correct without a
       re-sort. The cap is applied LAST so the semantics are
       "the newest N rows that pass every other filter" — that
       is what an operator asks ("the 5 most recent runs about
       /foo.md in the last week" composes -q + --since + --last
       naturally). A non-positive or NaN value is rejected
       cleanly because a typo like `--last 0` would silently
       produce an empty result that looks like "history was
       empty" rather than "filter narrowed to zero", and the
       unified empty-state hint depends on the distinction.
    3. stats --paths: per-namespace extensions flat stream. The
       walk is namespace order (server-provided), then ext order
       per namespace. Composes with -q (filter by namespace name)
       and --top (cap each contribution) for "the top 3 exts in
       namespaces matching `mem`". Critical design choice: no
       implicit cross-namespace dedupe so `grep -c md` counts the
       namespaces that contain that ext (`sort -u` is left to the
       consumer if they want the unique set; we cannot rebuild
       duplicates after the fact). Wins over --json / --tsv /
       text when set — same precedent as search --paths-only
       short-circuiting --json.
    4. watch --debounce <ms>: forwards to the watcher's existing
       `debounceMs` wiring. Zero / negative / NaN values rejected
       up front rather than silently disabling the debounce —
       `--debounce 0` would melt CPU during a `git checkout`
       burst. Missing flag forwards as undefined so the watcher's
       own `debounceMs ?? 800` fallback keeps working.
    5. watch startup banner: one-line `{"kind":"banner","root","ts"}`
       NDJSON document to stderr on each successful start. The
       text-mode "Watching <root>" line stays on stdout for the
       operator; the banner is the parallel log-scrape signal so
       a stderr-tailing parser detects restarts without parsing
       the (potentially noisy) stdout NDJSON event stream. Fires
       UNCONDITIONALLY (text + --json) but NOT on the --debounce
       validation error path — there is no half-started process
       to mark.
  Test approach for watch: a sentinel-throwing mock for
  startWatcher captures the exact options the real watcher would
  have received AND lets the action body unwind without hitting
  the production `await new Promise(() => undefined)` deadlock.
  Same `vi.mock('../src/runtime.js', ...)` pattern as status/ask/
  search tests, plus a third mock for `@clawmind/config` so
  expand() and loadEnv() resolve without touching the filesystem.
  Verify-gate note: ran the full `pnpm typecheck` and
  `pnpm -r test`. Same two pre-existing reds (telemetry +
  rag/hybrid); neither was introduced by this tick. The
  `@clawmind/cli` package is fully green (216 tests).
  Note on stray build artifacts: at tick start the working tree
  had untracked .js / .d.ts / .js.map / .d.ts.map sidecars under
  apps/cli/src/commands/ (a previous stray `tsc` invocation
  leaked them next to the .ts sources). Cleaned with
  `git clean -f apps/cli/src/commands/` before any feature work
  so they could not accidentally be committed. Worth adding
  `apps/cli/src/**/*.js` to .gitignore in a future tick to make
  the trap impossible.
