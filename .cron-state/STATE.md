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

### Tick 2026-06-21 23:08 PDT (current)

- [x] feat(status): emit --watch startup banner to stderr at loop start (696cce6)
- [x] feat(status): add --watch --check-after <n> to debounce 1-cycle blips (c712abb)
- [x] feat(watch): add --once --paths-only pure preview (no ingest, xargs-safe) (738037b)
- [x] feat(ask): --stream-json --out writes NDJSON event stream to file (no shell redirect needed) (c8f3810)
- [x] test(digest): pin --json --slim --since exact byte layout (NDJSON-friendly diff contract) (1b4b63c)

### Tick 2026-06-21 20:00 PDT

- [x] feat(status): add --watch <ms> + --max-polls <n> for a refreshing dashboard (11718bd)
- [x] feat(related): add --above/--below filter pair mirroring feedback list (a7e8e96)
- [x] feat(ask): add --stream-json for live NDJSON event streaming (75c5e05)
- [x] test(stale): pin --tsv --since composition byte layout (4d45a42)
- [x] feat(watch): add --once --since for one-shot incremental refresh (8496320)

### Tick 2026-06-21 16:57 PDT

- [x] feat(search): add --rerank-only debug flag (skipMmr through RAG retrieve) (2d9f396)
- [x] test(related): pin -n/--namespaces end-to-end forwarding contract (c1d622f)
- [x] feat(digest): add run --json --slim for 3-field cron-dashboard tally (b0da13a)
- [x] feat(forget): make --paths-only short-circuit win over --json (cron-safe combo) (08fcba0)
- [x] feat(stats): add --json --slim --tsv awk-pipeline shape (2-col namespace+files) (465b833)

### Tick 2026-06-21 13:26 PDT

- [x] feat(export): add --since end-to-end (API + CLI) for incremental conversation dumps (22bb5f4)
- [x] feat(search): add --rerank-off debug escape hatch through RAG retrieve() (d3419d3)
- [x] feat(watch): add --once for a single scheduled-scan pass (cron-friendly twin) (e747919)
- [x] feat(digest): add run --max <n> to cap the per-batch digest count (6ac0f90)
- [x] feat(pins/mutes): add list --by <user> for per-creator snapshot scoping (59d79f3)

### Tick 2026-06-21 10:11 PDT

- [x] feat(feedback): add prune --above <n> for cap-recalibration prunes (2ef0c8b)
- [x] feat(pins/mutes): add list --since <iso-date> for recent-only snapshots (51092d2)
- [x] feat(doctor): add --json --quiet slim shape for tight cron dashboards (41b383c)
- [x] feat(reindex): add --since <iso-date> for partial-reindex flow (becae0c)
- [x] feat(digest): add run --since <iso-date> to skip recently-run saved searches (c40a2ec)

### Tick 2026-06-21 07:05 PDT

- [x] chore(repo): ignore stray .js/.d.ts sidecars next to apps/cli/src/*.ts (d951f11)
- [x] feat(doctor): add --stale-after-days <n> end-to-end (API + CLI) (d9f9dda)
- [x] feat(ingest): add --dry-run + --paths-only rehearsal preview (fc6e3f2)
- [x] feat(tags): add list --sort <count|tag> and --top <n> (d589255)
- [x] feat(feedback): add prune --below <n> with --apply safety pattern (216077b)

### Tick 2026-06-21 04:13 PDT

- [x] feat(watch): add -q/--quiet to suppress per-file event chatter (3b48fdd)
- [x] feat(stale): add --paths-only as an alias for --paths to unify the flag family (6ac5d2b)
- [x] feat(stats): add --slim shape emitting just {stale, total} for cron pipelines (9796f9b)
- [x] feat(reindex): add --dry-run preview that lists files without touching the index (9bc0992)
- [x] feat(ingest): add --since <iso-date> for incremental refresh from cron (8ecf026)

### Tick 2026-06-21 00:40 PDT

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
- [ ] feat(digest): add `digest show --since-last` shortcut — bound to the saved-search's previous run timestamp ("what has this saved search surfaced since the last time I read it") without an explicit cutoff arg. NOTE: the most useful semantic is non-obvious: lastRunTs === history[0].ts always, so `>= lastRunTs` keeps only the newest row (identical to `--last 1`). A cleaner reading is "cutoff = history[1].ts (the previous run), filter ts > cutoff" so the only survivor is the newest row's diff against the prior run. Worth thinking about before shipping.
- [ ] feat(tags): add --counts mode listing namespaces with their tag-frequency totals (for "what tags are dominating my index" questions) — the new `tags list --sort count --top N` covers the lookup but a per-namespace breakdown is still missing. Requires API change too: needs a `/v1/tags?byNamespace=true` shape that joins paths -> namespace -> tags.
- [ ] feat(doctor): add --since <iso-date> for filtering findings by ts (cron dashboards want only the recent ones); pairs naturally with --json --quiet. NOTE: requires API change too — DoctorReport.findings entries don't carry a `ts` field today; either add one server-side or anchor the filter on report.generatedAt at the report level (less useful) — design decision pending.
- [ ] feat(reindex): add --since combined with --paths-only that pipes the filtered set into a single reindex call without touching the live path (preview-only, partial-reindex companion to the new --since). Already exists as `reindex --dry-run --since --paths-only` — possibly close to redundant; verify before re-shipping.
- [ ] feat(export): add --since composition test that round-trips through the live API end-to-end (the CLI test mocks fetch; the API test injects routes; a third test could spin up the real Fastify app + bind a tcp port and call through `clawmind export` to catch wire-format regressions)
- [ ] feat(search): add --rerank-only --json --no-snippet shortcut — slim payload (no snippet/highlights) on the no-MMR debug path so a rerank-only A/B run can compare the bare rank/path/score shape across the 3-way (default / --rerank-off / --rerank-only) without snippet noise inflating each payload 10x. Three flags compose naturally; the test is the smoke (current --no-snippet contract + current --rerank-only contract should already produce this for free, but pinning the byte shape would guard against a future regression).
- [ ] feat(stats): add --json --slim --since composition test that pins the byte layout when both flags fire (the new --slim --tsv contract is similar but covers --tsv only; --since composition is exercised elsewhere but not the EXACT byte layout that the slim shape produces under the cutoff)
- [ ] feat(related): add --above --paths-only composition test — pin the band filter's interaction with the pipeline-friendly emit (existing test pins --above alone but the combination with --paths-only deserves an explicit byte-layout pin).
- [ ] feat(watch): add --once --since composition test that pairs the new --since with --debounce (both should be silently accepted in --once mode; --since drives the filter, --debounce is a no-op).
- [ ] feat(status): add --watch --check-after --json composition test pinning the exit code stays 0 even when JSON snapshots all show ok=false (the --check-after debounce applies to exit code only, NOT to the per-cycle JSON shape; pin that contract so a dashboard reading the snapshots is never confused by the exit code's silence).
- [ ] feat(status): add --watch --json with embedded `cycle: N` index per snapshot so a downstream NDJSON consumer can detect dropped snapshots or sort across restart boundaries (currently each snapshot is self-contained but has no monotonic counter — a missing snapshot in the stream is silent).
- [ ] feat(watch): add --once --paths-only --json shortcut — instead of short-circuiting --json with --paths-only (current contract), emit `{root, count, files:[...]}` (mirrors `reindex --dry-run --json`). Currently --paths-only WINS over --json (matches forget/search/related precedent), but a `--paths-only --json` reader who explicitly wanted the JSON wrapper has no way to get it. Worth considering: maybe expose `--preview-json` as a separate flag for that consumer.
- [ ] feat(ask): add --stream-json --out --no-citations composition test — pin that --no-citations drops items[] from the file's sources doc but keeps the marker, just like the stdout shape (currently --no-citations is honoured in emitStreamDoc by the shared `if (opts.citations !== false)` branch; a regression where --no-citations only affected stdout and leaked items[] to the file would be invisible without a test pin).
- [ ] feat(ask): add --stream-json --out with empty answer (no token events between sources and done) — pin that the file body is exactly 2 lines (sources + done, no tokens) and the green stderr confirmation still fires with `(0 chars)`. The "empty answer" case is rare but real (a model that thinks it shouldn't reply) and the cron operator's `wc -l stream.ndjson` should still produce a sensible number.
- [ ] feat(ask): add --stream-json with `--out -` writing to stdout (the standard cli convention for "treat stdout as the output file"). Currently `--out -` would try to open a literal `-` file; a small special-case would let `clawmind ask --stream-json --out -` behave identically to `clawmind ask --stream-json`. Useful when a script passes `--out $VAR` and `$VAR` happens to be `-`.

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

- 2026-06-21 04:13 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 3b48fdd, 6ac5d2b, 9796f9b, 9bc0992, 8ecf026. Test gate:
  `@clawmind/cli` 254/254 vitest pass (up from 216). 38 net new tests
  spread across 5 files: watch.test.ts (+9 → 21), stale.test.ts (+4
  → 15), stats.test.ts (+7 → 45), reindex.test.ts (new, 10),
  ingest.test.ts (new, 8). Typecheck: `@clawmind/cli` clean. Same
  two pre-existing reds outside cli (telemetry OpenTelemetry 1.x/
  2.x peer mismatch + rag/hybrid test alpha-blend drift); neither
  introduced this tick. Verified the telemetry red is pre-existing
  by running `pnpm --filter @clawmind/telemetry typecheck` on a
  clean working tree before any commits — same error.
  Theme: round out the cron pipeline contract (incremental refresh,
  preview before mutation, slim cron snapshots, unified naming).
    1. watch --quiet / -q: suppresses the per-file event chatter
       in BOTH text mode (the gray `add /foo.md` lines) and --json
       mode (the per-event NDJSON documents). Critically the
       startup banner on stderr STILL fires AND the
       "Watching <root>" stdout line STILL prints, so a log
       scraper detects restarts and an interactive operator sees
       the watcher came up. The contract is "no chatter, restart
       marker stays" — matches how logrotate / journalctl
       --since=last-restart expect restart-aware peers to behave.
       The cron use is a watcher restarted by cron whose journal
       only needs the restart marker, not 100/sec event chatter
       from a tight `npm install` burst. Composes with --debounce
       (orthogonal concerns: --debounce shapes re-ingest cadence,
       --quiet shapes the operator-facing stream).
    2. stale --paths-only: alias for --paths to unify the flag
       family. stale shipped first with --paths and pinned the
       byte layout in tests; every later list-style command
       (search/forget/related/pins/mutes/aliases/tags) adopted
       --paths-only as canonical. Both flags now emit byte-
       identical streams; existing --paths scripts keep working
       unchanged AND new scripts can use the family-wide
       --paths-only naming without special-casing stale. When both
       are passed the effect is identical (no warning, no
       precedence — they are truly equivalent and the action body
       short-circuits on a single OR rather than emitting twice).
    3. stats --slim: slim JSON shape `{stale: [<namespace>],
       total: N}` carrying ONLY namespace names (no per-namespace
       metric blocks, no totals, no generatedAt). The natural
       cron pair is `clawmind stats --json --slim --since <iso>`
       to answer "which namespaces have gone stale at the
       namespace level" without piping the full report through
       `jq` for the names. Invariants pinned in tests:
       total === stale.length (consumer never reconciles two
       fields); single-line output for clean snapshot diffing;
       --slim wins over --compact (both ask for one-line JSON,
       --slim is the stricter reshape); empty payload is a clean
       `{stale: [], total: 0}` so `jq -e '.total > 0'` branches
       on emptiness without inspecting the array.
    4. reindex --dry-run: the "preview the destructive action"
       gate. Walks the same discoverFiles() the real ingest
       would visit (so the preview is byte-faithful to the real
       run, with .clawmindignore and the built-in include/exclude
       globs both applied) WITHOUT dropping the manifest,
       touching the BM25, or invoking ingest. Three output
       shapes: --paths-only (xargs-safe, one path per line, no
       header), --json ({root, count, files}), default text
       (yellow count header + gray path list + rerun nudge).
       Matches the forget --dry-run UX. Zero-discovered yields a
       count-zero header with NO rerun nudge (nothing to reindex
       => nothing to rerun) and a clean empty stream in
       --paths-only mode.
    5. ingest --since <iso-date>: the incremental-refresh gate.
       Without --since, ingest walks every file under the
       workspace and lets the per-file hash/manifest dedupe path
       skip anything unchanged — correct but expensive on a
       large index. --since cuts off the work much earlier:
       stat() each discovered path and drop the ones whose mtime
       predates the cutoff BEFORE any reading happens. Classic
       cron use:
         clawmind ingest --since "$(date -u -d '1 hour ago' +%FT%TZ)"
       Design choices:
       - Cutoff INCLUSIVE (mtime >= cutoff): a file modified
         exactly at the cutoff is "modified at the cutoff",
         which is the boundary an operator passing the previous
         tick's wall-clock cares about. Exclusive bounds would
         silently miss changes that happened in the same second
         as the previous tick — anti-goal of the flag.
       - Parse failures abort with exit 1, not silent degrade to
         "no filter". A typo like --since 2026-13-01 silently
         re-ingesting the whole workspace is the worst possible
         failure mode for a flag whose entire purpose is to do
         less work.
       - stat() failures on individual files are non-fatal: the
         file is silently dropped (cannot be re-ingested anyway).
       - Filtered list goes through ingestPaths(); the no-flag
         path still uses ingestRoot() byte-for-byte.
  Push: 4b6ffdc..8ecf026 main -> main. No PRs created. All
  commits authored as `Cake (cron)
  <51058514+Sanjays2402@users.noreply.github.com>`.
  Verify-gate note: ran `pnpm run ci:verify` which hit the same
  two pre-existing reds (telemetry typecheck + rag hybrid test);
  neither introduced by this tick. The `@clawmind/cli` package
  is fully green (254 tests, +38 from prior tick).

- 2026-06-21 07:05 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: d951f11, d9f9dda, fc6e3f2, d589255, 216077b. Test gate:
  `@clawmind/cli` 292/292 vitest pass (up from 254). 38 net new tests
  spread across 4 files: doctor.test.ts (+6 → 15), ingest.test.ts
  (+10 → 18), tags.test.ts (+10 → 14), feedback-digest.test.ts
  (+11 → 52). Also added a new prune-cli describe block. `@clawmind/api`
  tests pass 1223/1223 (the doctor route schema change is backwards
  compatible because the new querystring parameter is optional).
  `@clawmind/cli` typecheck: clean. Same two pre-existing reds outside
  cli (telemetry OpenTelemetry 1.x/2.x peer mismatch + rag/hybrid test
  alpha-blend drift); both verified pre-existing in this tick by
  running `pnpm --filter @clawmind/telemetry typecheck` and `pnpm -r
  test` on a clean working tree before the diff was committed —
  identical errors, neither introduced here.
  Theme: knock out THREE explicitly-queued items (the doctor
  --staleAfterDays flag the queued list called out by name; the
  ingest --paths-only --dry-run rehearsal shortcut the queued list
  called out by name; the .gitignore trap the queued list called
  out by name) PLUS two scripting-ergonomics features that mirror
  contracts already in the cli (tags list --sort/--top mirrors
  stats; feedback prune --below mirrors feedback list --below +
  forget --apply).
    1. chore(repo) .gitignore: four new globs — `apps/cli/src/**/*.js`,
       `*.d.ts`, `*.js.map`, `*.d.ts.map` — so a stray `tsc`
       invocation inside apps/cli (instead of through `pnpm build`,
       which writes to apps/cli/dist) cannot leak build artifacts
       into the source tree. The `.d.ts.map` glob is the subtle one:
       tsc's --declarationMap emits .d.ts.map alongside .d.ts and
       the bare `*.d.ts` glob does NOT match it. Caught and cleaned
       in the 2026-06-21 00:40 PDT tick; this makes the trap
       impossible going forward.
    2. doctor --stale-after-days end-to-end (API + CLI):
       /v1/doctor route grew an optional ?staleAfterDays=<n> query
       string. CLI grew a matching --stale-after-days flag that
       forwards as the query string. Server-side bound 0..3650 days
       (zero is a valid tripwire for "any age counts as stale";
       3650 is ~10 years cap to catch typos). Client-side bound-
       check fires BEFORE the fetch so a negative / out-of-range /
       non-numeric value aborts with a single crisp message instead
       of wasting a round-trip on the API's generic 400. The
       natural cron use is `clawmind doctor --severity error
       --stale-after-days 1` for a nightly CI freshness SLO.
       Without the flag the URL is byte-for-byte legacy /v1/doctor
       so every existing dashboard works unchanged (regression
       pinned).
    3. ingest --dry-run + --paths-only: a natural cron pre-flight.
       Previews the set of files an incremental refresh WOULD
       touch (composes with --since so the preview matches the
       refresh) without reading, hashing, or upserting anything.
       Output shapes match `reindex --dry-run` byte-for-byte
       (--paths-only > --json > text). The --since validation
       fires BEFORE the dry-run branch so a typo'd cutoff still
       kills the run cleanly (no silent degrade to a misleading
       "full discovery" preview). Empty dry-run yields a clean
       count-zero header in text mode and a clean empty stream
       in --paths-only mode. The --paths-only contract now spans
       every list-style command in the cli: search, forget,
       stale, related, pins, mutes, aliases, tags, reindex, and
       ingest all emit the same byte layout for xargs/wc -l.
    4. tags list --sort <count|tag> and --top <n>: shapers that
       mirror `stats --sort` / `stats --top` byte-for-byte so the
       muscle memory carries between the two. --sort count
       (default) keeps the API order verbatim; --sort tag re-sorts
       alphabetical (diff-stable for cron snapshots). --top is the
       final shaper (slices the head off the sorted list AFTER
       --sort). Non-positive or NaN --top clamps to "no cap"
       rather than yielding a surprising empty table (mirrors
       stats --top clamping). --top 0 falls back to the full
       list. The `count` field in --json reflects the post-cap
       length (every other --top in the cli already honours
       this).
    5. feedback prune --below <n> --apply: destructive sibling of
       `feedback list --below`. The cron answer to "every Sunday
       morning, clear feedback entries whose boost has decayed
       below 0.7". --below is REQUIRED (no "prune everything"
       shorthand — an auto-completed `feedback prune --apply`
       must never wipe the map). Strict comparison (matches the
       `feedback list --below` semantic, pinned with a /neutral.md
       row at boost === 1.0 that --below 1.0 must NOT match).
       Mirrors the `forget --apply` safety pattern: dry-run by
       default, --apply for the destructive run. The dry-run is
       byte-identical to the apply call MINUS the DELETE so the
       operator copy-pastes their preview + " --apply" to move
       from rehearsal to destruction. Partial failures do NOT
       abort the rest of the prune; failed paths are surfaced in
       report.errors[] and exit code is set BEFORE the --json
       early-return so JSON and text consumers agree on the
       failure signal.
  Verify-gate note: ran `pnpm run ci:verify` which hit the same
  two pre-existing reds (telemetry OpenTelemetry 1.x/2.x +
  rag/hybrid alpha-blend) — both verified pre-existing in THIS
  tick by running the failing commands on a clean working tree
  before the diff was committed. `@clawmind/cli` package is
  fully green (292 tests, +38 from prior tick) AND `@clawmind/cli`
  typecheck is clean. `@clawmind/api` tests pass 1223/1223
  including all 6 doctor route tests with the new query schema.
  Push: 504d92a..216077b main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.

- 2026-06-21 10:11 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 2ef0c8b, 51092d2, 41b383c, becae0c, c40a2ec. Test gate:
  `@clawmind/cli` 329/329 vitest pass (up from 292). 37 net new tests
  spread across 5 files: feedback-digest.test.ts (+14 → 66), pins.test.ts
  (+5 → 9), mutes.test.ts (+4 → 8), doctor.test.ts (+7 → 22),
  reindex.test.ts (+7 → 17). `@clawmind/cli` typecheck: clean.
  Same two pre-existing reds outside cli (telemetry OpenTelemetry 1.x/
  2.x peer mismatch + rag/hybrid alpha-blend drift); neither
  introduced this tick (verified by running ci:verify which hit the
  identical telemetry red as every prior tick, and by running
  `pnpm --filter @clawmind/api test` against my head AND against the
  parent — `@clawmind/api` 1223/1223 in both, the 2 flakes on one
  parallel run dropped to 0 on the second run; not my changes).
  Theme: knock out four explicitly-queued items + complete the
  --above/--below symmetry on feedback prune that the queued list
  had explicitly carved out.
    1. feedback prune --above: symmetric sibling of --below. The
       classic cron use is a cap recalibration ("we lowered
       MAX_BOOST from 1.5 to 1.45, clear every entry above 1.45 so
       re-vote pressure restarts cleanly"). Strict comparison (`>`)
       so an entry at exactly the threshold is preserved (it is ON
       the new ceiling, not above it). Composes with --below as an
       OR predicate so a single invocation can trim both tails
       (`--above 1.05 --below 0.95 --apply` clears everything
       outside the [0.95, 1.05] neutral band). At least one of
       --below/--above is now required (the existing tripwire
       generalises). Text mode header narrates the predicate that
       ran ("below boost 0.95 or above boost 1.04") so the cron
       log is auditable.
    2. pins/mutes list --since <iso-date>: client-side post-filter
       on pinnedAt / mutedAt. The natural cron use is a daily
       snapshot of "what got pinned (or muted) in the last 24h"
       without scrolling through every entry. Mirrors the --since
       semantics on stale/stats/digest show byte-for-byte (cutoff
       INCLUSIVE >=; composes with -q as intersection; recomputed
       count reflects filtered length; filter applies BEFORE
       --paths short-circuit; typo'd cutoff aborts cleanly with
       exit 1 instead of silently degrading to "no filter").
       Single feature touching both files because the symmetry is
       what makes the cron use real (`pins list --since X --paths`
       and `mutes list --since X --paths` must behave identically).
    3. doctor --json --quiet: slim 5-field shape for tight cron
       dashboards. `{ok, findingsCount, errors, warnings, infos}`
       instead of the full per-finding payload. The classic cron
       use is a dashboard panel that needs "is the index ok? how
       many errors?" in five fields without piping the full report
       through jq for the count. Pairs naturally with --severity
       error for a nightly CI freshness gate:
         clawmind doctor --json --quiet | jq -e '.errors == 0'
       Design properties: `ok` mirrors the FULL report's flag so
       hiding findings via --severity never accidentally hides an
       unhealthy report from the slim shape; `findingsCount` is
       the TOTAL count (not the filtered visible count); per-
       severity tallies use the API's vocabulary verbatim; single-
       line JSON for clean NDJSON snapshot diffing; exit code
       still reflects r.ok; --quiet without --json is a no-op
       (text mode unchanged); --quiet wins over the full --json
       payload when both set.
    4. reindex --since <iso-date>: mtime filter for a partial-
       reindex flow. Composes with both --dry-run (preview the
       narrowed set without mutating) AND the destructive path
       (when set without --dry-run, the wipe still happens, then
       ingest is called with --since so only the recently-modified
       files are re-ingested; sources older than the cutoff stay
       MISSING from the rebuilt index until the next full reindex).
       The natural use: `clawmind reindex --since "$(date -u -d
       '1 week ago' +%FT%TZ)"` rebuilds from scratch but only
       walks the files that changed recently. CRITICAL SAFETY:
       parse failures abort BEFORE any wipe — the live path runs
       the manifest+BM25 wipe FIRST then calls ingest, so a typo'd
       cutoff landing mid-flight would leave the index in a
       partial state the operator could only recover from with a
       full reindex (defeating the whole purpose of the flag).
       Validation hard-fails up front. Other contract pinning:
       cutoff INCLUSIVE (>=) — matches the --since semantics across
       ingest/stale/pins/mutes/stats/digest show; stat() failures
       on individual files are non-fatal (drop the file silently);
       --paths-only short-circuits before --json with --dry-run.
    5. digest run --since <iso-date>: narrows the batch path to
       saved searches whose lastRunTs predates the cutoff. The
       natural cron use is "re-run only digests that have not run
       in the last hour", which lets a frequent tick (every 5min)
       catch newly-added + drifted digests while skipping anything
       a slower tick already covered. Implementation: list
       /v1/digests, filter client-side, then POST per-id to
       /v1/digests/<id>/run for each survivor (instead of
       /v1/digests/run which unconditionally runs every saved
       search). A few extra round-trips but the LLM/embed budget
       skipped on the recent-runs path dominates the cost.
       Contract: cutoff parse failures abort with exit 1 BEFORE
       any list/run; lastRunTs === null (never-run digest) is
       ALWAYS INCLUDED (most extreme case of "needs running"; a
       filter that hid never-runs would be unsafe for a new saved
       search the operator just added); strict less-than (<) so a
       digest at exactly the cutoff is SKIPPED (it ran AT the
       cutoff, satisfying the "leave alone if it ran within the
       last hour" intent); single-digest failures do NOT abort the
       batch (other digests proceed; failing digest retries on
       next tick); --since is ignored when an id is passed (no
       batch to filter); text-mode header narrates both ran and
       skipped counts so a cron log is readable.
  Push: 216077b..c40a2ec main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.
  Bonus polish: amended the digest commit (c40a2ec) to fix a
  typo'd email (`51058514+Sanjays2402+Sanjays2402@...` had a stray
  repeat) before push — caught by `git log -1 --pretty=format:%ae`
  in the verify step. All five SHAs now carry the canonical
  noreply ID.

- 2026-06-21 13:26 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 22bb5f4, d3419d3, e747919, 6ac0f90, 59d79f3. Test gate:
  `@clawmind/cli` 368/368 vitest pass (up from 329). 39 net new tests
  spread across 5 files: export.test.ts (+7 -> 15), search.test.ts
  (+5 -> 30), watch.test.ts (+10 -> 31), feedback-digest.test.ts
  (+7 -> 73), pins.test.ts (+6 -> 15) + mutes.test.ts (+4 -> 12).
  Plus +2 in `@clawmind/rag` pipeline.test.ts (4/4 total) and a new
  `apps/api/test/conversation-export-since.test.ts` (7/7) for the
  route-level export contract. `@clawmind/cli` typecheck: clean.
  `@clawmind/api` 1230/1230 on a clean re-run (one flake on
  api-key-bruteforce timing-dependent lockoutMs assertion in a
  parallel run; not my changes -- verified by running just that file
  in isolation which passed 10/10). Same two pre-existing reds
  outside cli (telemetry OpenTelemetry 1.x/2.x peer mismatch + rag/
  hybrid alpha-blend drift); neither introduced this tick (verified
  by running each in isolation and the alpha-blend one is the same
  failure that has been queued since 2026-06-20 16:05 PDT).

  Theme: knock out FOUR explicitly-queued items + a structural
  improvement to the RAG pipeline interface for debugging.

    1. export --since end-to-end (API + CLI). Server-side: optional
       ?since=<iso-date> on the three per-conversation export routes
       (md / json / csv). INCLUSIVE >= semantics matching every
       other --since across the cli. Empty windows return a
       well-formed export with zero turns, NOT a 404, so a cron
       polling a quiet conversation does not alarm. Invalid ISO
       date returns 400 so a typo cannot silently degrade to the
       full export (would double-bill the bandwidth budget for the
       exact use case the flag was added to fix). Permission check
       fires BEFORE the narrow so --since cannot be used to peek
       at another user's thread. CLI-side: forwards as
       ?since=<encodeURIComponent(value)> so colons / tz offsets
       survive the querystring; validates client-side too so a typo
       aborts BEFORE any round-trip. Without --since the URL is
       byte-for-byte unchanged from the legacy contract (no stray
       `?`, no empty parameter) so every existing script keeps
       working. Two test surfaces: cli (mocked fetch + URL
       assertion) and api (Fastify inject + INCLUSIVE-cutoff /
       md+csv body / empty-window / invalid-ISO / cross-user
       isolation).
    2. search --rerank-off debug escape hatch. Threaded a new
       RetrieveOptions { skipRerank } param through the RAG
       retrieve() pipeline (deps, q, meta, options). When set, the
       pipeline bypasses lexicalRerank entirely and forwards the
       raw boost-adjusted ordering to MMR. Other stages (embed,
       hybrid merge, MMR) stay enabled because they are correctness
       or UX-critical. CLI exposes --rerank-off; forwards
       { skipRerank: true } when set, undefined when absent (NOT
       { skipRerank: false }) so the pipeline default stays unchanged
       for every existing caller. The rag-side test pins the SCORE
       DIFFERENCE rather than ordering -- the lexical bonus on a
       chunk with 20 exact-term occurrences gives a delta > 0.3,
       which is the cleanest signal that the stage actually ran or
       was actually skipped. Pre-existing callers are byte-identical
       (regression test pinned).
    3. watch --once for a single scheduled-scan pass. Lets cron use
       ONE code path for both scheduled refreshes (`watch --once`)
       and live watching (`watch` without --once). The one-shot path
       runs the SAME discoverFiles() + ingestPaths() the chokidar
       watcher's initial scan would do, then exits cleanly with the
       regular ingest report shape. The chokidar tail is NOT
       installed (lastWatcherOpts stays null -- pinned by test as
       the headline contract). The startup banner on stderr STILL
       fires so a log scraper sees the restart marker even on a
       one-shot pass. The "Watching <root>" stdout line is DROPPED
       because there is no long-running process to mark; that label
       would lie on a process about to exit. --debounce / --quiet
       are accepted silently in --once mode (no rejection, no
       behaviour change) so a cron operator can use ONE argv shape
       for both modes. --debounce validation still fires UP FRONT in
       --once mode -- a typo catches early rather than later when
       switching to the live path. Test approach: update the
       existing @clawmind/ingest mock to provide discoverFiles +
       ingestPaths alongside the existing startWatcher stub, then
       assert chokidar is never installed AND the discover/ingest
       call happened exactly once.
    4. digest run --max <n>. Caps how many saved searches run in a
       single batch tick. Surviving candidates after --since
       narrowing are kept in API order (newest-first, stable) and
       the head N are run; the remainder rolls over to the next
       tick because they STILL satisfy --since when it fires again.
       The cap is enforced AT the call site, NOT via post-filtering
       after wasted requests -- per-id POST count equals exactly N.
       Report shape adds `sinceSkipped` / `deferred` / `max` keys
       alongside the existing `ran` / `skipped` / `since` /
       `results`; the combined `skipped` key still sums both reasons
       so the legacy contract holds for every existing parser. Text
       body narrates the two skip reasons separately ("ran 10,
       deferred 3, not stale enough 2") so cron logs are auditable.
       Validation: --max non-positive / NaN aborts BEFORE the list
       fetch (a typo silently becoming an empty batch is
       indistinguishable from a real "nothing to run" tick, which is
       the worst possible failure mode for a cap flag). Ignored
       when an id is passed (single-id runs always run that one
       digest) -- mirrors --since on the same path.
    5. pins/mutes list --by <user>. Filter pins/mutes snapshots to
       entries whose pinnedBy / mutedBy === <user> EXACTLY (NOT
       substring). The exact-match contract is the critical defence
       against per-user audit bleed in a workspace with role-
       suffixed ids (`sanjay-readonly` does NOT match `--by
       sanjay`). Two commands shipped together because the symmetry
       is the entire point -- a cron operator scripting per-user
       snapshots wants the same flag on both sides of the pin/mute
       pair without conditional plumbing. Composes with -q
       (server-side substring filter, content-based) and --since
       (client-side recency filter) as an intersection: -q narrows
       content first, --by narrows creator second, --since narrows
       recency third, all applied BEFORE the --paths / --json /
       text short-circuit. Recomputed count reflects every filter
       that ran; empty-state hint in text mode follows the
       recomputed count, NOT the API total (pinned by test).

  Verify-gate note: ran `pnpm --filter @clawmind/cli test` (368/368
  pass), `pnpm --filter @clawmind/rag test` (43/44 pass -- the 1
  fail is the queued hybrid alpha-blend red), `pnpm --filter
  @clawmind/api test` (1230/1230 pass on second run; one flaky
  timing test on api-key-bruteforce in a parallel run, isolated
  test passes 10/10), `pnpm --filter @clawmind/cli typecheck`
  (clean), and `pnpm typecheck` (only red is the queued telemetry
  OpenTelemetry peer mismatch). Same two pre-existing reds as
  every prior tick; neither introduced here. Push: 0028623..59d79f3
  main -> main. All five commits authored as `Cake (cron)
  <51058514+Sanjays2402@users.noreply.github.com>`.

  Theme connector: this tick is the explicitly-queued sweep. Four
  of the five features (export --since, search --rerank-off, watch
  --once, pins/mutes --by) were named in the queued list by exact
  shape; the fifth (digest run --max) was named by intent ("cap
  how many digests fire in a single batch tick"). The structural
  change (RetrieveOptions through retrieve()) is the first time
  the RAG pipeline has exposed a stage-bypass dial -- set up so
  future debug knobs land cleanly on the same interface.

- 2026-06-21 16:57 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 2d9f396, c1d622f, b0da13a, 08fcba0, 465b833. Test gate:
  `@clawmind/cli` 393/393 vitest pass (up from 368). 25 net new tests
  spread across 4 files: search.test.ts (+6 -> 36), related.test.ts
  (+4 -> 17), feedback-digest.test.ts (+4 -> 77), forget.test.ts
  (+4 -> 16), stats.test.ts (+7 -> 52). Plus +4 in `@clawmind/rag`
  pipeline.test.ts (8/8 total) for the skipMmr stage-bypass path.
  `@clawmind/cli` typecheck: clean. `@clawmind/api` 1230/1230 on a
  clean re-run (snapshots prune-arithmetic test flaked once in a
  parallel run; isolated run passes 11/11, not my changes -- I did
  not touch apps/api this tick). Same two pre-existing reds outside
  cli (telemetry OpenTelemetry 1.x/2.x peer mismatch + rag/hybrid
  alpha-blend drift); neither introduced this tick.

  Theme: knock out the explicitly-queued sweep -- FIVE of five
  features were named in the queued list by exact shape. The
  --rerank-only flag pairs the existing --rerank-off into a 3-way
  A/B against the same query, the related namespaces test pins a
  contract that existed since day one but had no regression
  coverage, the digest slim shape mirrors doctor --quiet for the
  cron-budget dashboard panel, the forget paths-only short-circuit
  fixes a fragile-script edge case (operators who always pass
  --json now get path-per-line when also passing --paths-only),
  and the stats slim-tsv shape is the awk-pipeline contract on
  the slim path.

    1. search --rerank-only (skipMmr through RetrieveOptions). The
       second debug escape hatch on the RAG pipeline, mirroring
       --rerank-off. Bypasses the MMR diversity reorder so the
       operator sees what the lexical rerank step ALONE thinks is
       the most relevant set, in rerank-score order. Forwards
       { skipMmr: true } through retrieve(); pipeline returns the
       head q.k of the rerank output (sliced, NOT mmrRerank). Both
       flags can be combined for the most extreme bypass ("show
       me the raw hybrid+boost ordering with no heuristic stages
       applied"). Critical design property: when neither flag is
       set, the options arg stays UNDEFINED (NOT {}) so every
       existing caller in the codebase is byte-identical to
       before. Pipeline-side test pins skipMmr genuinely changes
       the result set (3 same-document chunks survive instead of
       MMR's diversity-promoted /other.md chunk), honours q.k,
       regression on the default path, and the combined
       skipRerank+skipMmr case. CLI-side test pins the flag
       forwarding shape across the 3-way and the composition
       with --threshold / --paths-only.

    2. related -n/--namespaces end-to-end regression test. The
       flag has existed since the command first shipped but
       never had a test asserting the URL it produces. Four new
       tests pin the contract: -n forwards verbatim as
       ?namespaces=<csv>; --namespaces (long form) produces the
       SAME url as -n (catches binding drift); WITHOUT the flag,
       the param is OMITTED entirely (not sent as empty string,
       which a stricter future server schema could read as
       "match nothing"); composes with -k and --threshold (the
       URL carries -n and -k, --threshold stays client-side).
       Defensive coverage on a flag whose silent failure would
       leak every existing pipeline depending on namespace
       narrowing.

    3. digest run --json --slim. Mirrors `doctor --json --quiet`
       byte-for-byte: emit ONLY {ran, deferred, sinceSkipped} —
       the three integers a cron dashboard panel needs to answer
       "did the cron tick get through the batch?" without
       parsing the per-id results blob. Single-line JSON for
       clean NDJSON snapshot diffs. The canonical cron poll is
       `clawmind digest run --since X --max 10 --json --slim` —
       three integers tell the dashboard whether the cap fired,
       whether the cutoff filtered candidates, and how many
       actually ran. The combined `skipped` total is dropped
       from the slim shape (recomputable as deferred+sinceSkipped
       if a consumer wants the legacy field). Empty workspace
       yields `{ran:0, deferred:0, sinceSkipped:0}` (valid JSON
       so `jq -e '.ran > 0'` does not parse-error on a quiet
       tick). --slim without --json is silently ignored
       (text-mode unchanged); ignored when an id is passed (no
       batch to slim).

    4. forget --paths-only short-circuit (paths-only WINS over
       --json). Before this tick, --json won over --paths-only
       on the forget command and a script that always passed
       --json for ApiError safety AND --paths-only when it
       wanted xargs-ready output had to conditionally strip
       --json — fragile and not what the operator's intent was.
       Now --paths-only short-circuits BEFORE the --json branch
       so the combo `--json --paths-only` (and the
       explicit-everything `--apply --json --paths-only`) emits
       one path per line. Matches the precedent set by `search
       --paths-only`, `related --paths-only`, and the
       pins/mutes/aliases/tags --paths family: pipeline-friendly
       trumps machine-readable. Critical regression: --json
       WITHOUT --paths-only still emits the structured payload
       so every existing JSON consumer is byte-identical to
       before; the short-circuit is GATED on --paths-only being
       set.

    5. stats --json --slim --tsv. The awk-pipeline shape on the
       slim path: one `<namespace>\\t<files>` row per surviving
       namespace, no header, no totals row, no ANSI. The canonical
       cron use is `clawmind stats --json --slim --tsv --since X
       | awk -F'\\t' '$2 > 100'` — two filters in one pipeline
       (staleness via --since at namespace level, size via awk
       on column 2) without `jq` flattening the slim shape.
       Files (NOT bytes/chunks) for the second column because
       files is the cheapest "size" signal and matches what
       `stale --paths` counts (so the two contracts compose:
       `wc -l` on stale --since X --paths agrees numerically
       with `awk '{s+=$2} END {print s}'` on the slim-tsv
       restricted to the same namespaces). Flag resolution
       order fully documented: --paths > --json > --tsv > text
       (existing), within --json: --slim > --compact (existing),
       within --slim: --tsv > slim-default JSON (NEW). Pin
       the contract with empty-stream + -q composition +
       --since composition + 3 regression tests (--json --tsv
       without --slim still emits JSON, --tsv without --json
       still emits the existing 5-col TSV, --slim --tsv without
       --json falls through to the existing 5-col TSV).

  Push: 0028623..465b833 main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.
  Verify-gate note: ran `pnpm --filter @clawmind/cli test`
  (393/393 pass), `pnpm --filter @clawmind/rag test` (47/48 pass,
  the 1 fail is the queued hybrid alpha-blend red; my 4 new
  skipMmr tests pass), `pnpm --filter @clawmind/api test`
  (1230/1230 pass on second run, snapshots prune-arithmetic
  flake on one parallel run isolated to 11/11), `pnpm --filter
  @clawmind/cli typecheck` (clean), `pnpm typecheck` (only red
  is the queued telemetry OpenTelemetry peer mismatch). Same
  two pre-existing reds as every prior tick; neither introduced
  here.

  Theme connector: this tick is the explicit-queue sweep, again.
  Five of five features were named in the queued list. The
  related namespaces test is the rarest shape -- a pure test-
  only commit pinning a contract that has been live but unguarded
  for the entire repo's history. The rerank-only flag completes
  the RAG pipeline's debug-dial set: ANY combination of skipRerank
  + skipMmr can now be requested through retrieve(), surfaced as
  the corresponding 3-way A/B on the cli (default / --rerank-off
  / --rerank-only / both). The slim shape pattern (doctor --quiet,
  stats --slim, NOW digest run --slim) is now firmly the cli's
  preferred cron-dashboard contract -- a 3-5 field JSON shape on
  a single line, easy to NDJSON-diff. The forget short-circuit
  is a small but real fix: it removes a script-fragility class
  ("strip --json conditionally before --paths-only or you get
  the wrong shape") that the queued item carved out as worth a
  smoke test.

- 2026-06-21 20:00 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 11718bd, a7e8e96, 75c5e05, 4d45a42, 8496320. Test gate:
  `@clawmind/cli` 423/423 vitest pass (up from 393). 30 net new tests
  spread across 5 files: status.test.ts (+7 -> 14), related.test.ts
  (+7 -> 24), ask.test.ts (+5 -> 21), stale.test.ts (+3 -> 18),
  watch.test.ts (+7 -> 38, with a new node:fs/promises mock for the
  --since path). `@clawmind/cli` typecheck: clean. `@clawmind/api`
  1229/1230 in parallel (the api-key-bruteforce timing flake — same
  one that flakes every tick; 10/10 in isolation, not my changes).
  `@clawmind/rag` 47/48 (the queued hybrid alpha-blend red, neither
  introduced nor touched this tick). Same two pre-existing reds
  outside cli (telemetry OpenTelemetry 1.x/2.x peer mismatch +
  rag/hybrid alpha-blend drift); neither introduced this tick.

  Theme: knock out a queued sweep that mixes substantive new
  features with smaller queued items. Three of five were named
  in the queued list by exact shape (--watch, --above/--below,
  --stream-json); the fourth (--tsv --since composition test) was
  named by exact shape; the fifth (--once --since composition)
  was named in the queue. Together they bring the cli's cron
  surface up another notch on real-time monitoring (--watch),
  live UI streaming (--stream-json), retrieval diagnostics
  (--above/--below), and incremental refresh (--once --since).

    1. status --watch <ms> + --max-polls <n>. Turns the one-shot
       status into a polling loop for a refreshing terminal
       dashboard. Pre-this, an operator monitoring a recovering
       provider used `watch -n 5 clawmind status` which re-warms
       the runtime on every tick (re-reading the manifest,
       re-loading the bm25, re-opening the lance handle). The
       --watch loop reuses the SAME runtime across cycles, so
       per-cycle latency is dominated by the two health probes,
       not the cli warmup. Output shapes:
         - text + TTY stdout: ANSI cursor-up + clear-line in-place
           render (one refreshing panel, the htop/top UX)
         - text + non-TTY stdout: print each snapshot in full (logs
           benefit from the historic context)
         - --json: one self-contained JSON document per cycle on
           its own line (NDJSON by construction)
       --max-polls <n> bounds the loop; required for cron-style
       probes wanting exactly N snapshots before exit, and required
       by the test suite to exercise the loop without leaking
       timers. Without --max-polls the loop runs until SIGINT
       (intercepted so the loop breaks cleanly and the final exit
       code still reflects the final probe state). --check on a
       watch loop sets the FINAL exit code to 2 if the LAST
       snapshot is unhealthy — deliberately not exiting early on
       the first bad probe because the watcher is a monitoring
       tool, not a circuit breaker; the operator wants to see the
       recovery cycle. Validation: --watch < 100ms rejected up
       front (typo'd --watch 0 would melt CPU); --max-polls
       non-positive / NaN rejected (silent degrade to "no cap"
       would defeat the entire purpose). --max-polls without
       --watch is silently ignored (matches the precedent set by
       --slim without --json on digest run).

       Refactor: pulled snapshotStatus() + renderText() +
       emitCheckStderr() out of the action body so both the
       one-shot path AND the watch loop produce identical
       output shapes per cycle. A dashboard consuming
       `clawmind status --json` does not have to special-case
       the --watch variant.

    2. related --above/--below filter pair. Symmetric sibling of
       --threshold mirroring `feedback list --above/--below`
       byte-for-byte. Strict comparisons (> and <), non-numeric
       silently ignored (matches --threshold), both flags compose
       as an intersection with each other AND with --threshold.
       The classic cron use family in one invocation each:
         --above 0.9                  -> the strongest signal
                                         neighbours (isolation
                                         diagnostic)
         --below 0.4                  -> the weakest survivors
                                         (about-to-drop-out
                                         diagnostic)
         --above 0.5 --below 0.8      -> the marginal band
         --threshold 0.5 --above 0.7  -> half-open [0.5, ...]
                                         hardened by a strict
                                         tighter floor
       Strict inequality matches `feedback list --above/--below`
       and is the right semantic for diagnostic questions like
       "only the strongest signals" — a neighbour exactly at the
       bar is on the edge, not past it. The API does not
       currently accept above/below query parameters, so the
       filter is client-side — same precedent as --threshold.

    3. ask --stream-json. Live NDJSON event stream, one document
       per line, emitted as the underlying askStream generator
       produces them:
         {"kind":"sources","count":2,"items":[...]}          // first
         {"kind":"token","value":"hello "}                    // per token
         {"kind":"token","value":"world"}
         {"kind":"done","latencyMs":42,"model":"fake-model"} // last
       Bridges the gap between text mode (token-by-token to stdout
       with ANSI a JSON consumer cannot parse) and --json (assembled
       payload AFTER the LLM completes, forcing the UI to wait the
       full latencyMs). A live UI sees the citation set up front
       (sidebar) AND paints the answer letter-by-letter (main
       panel). Single-line JSON per event so `jq -c .` round-trips
       cleanly. Pairs with --threshold (skip emits
       {kind:"sources"} + {kind:"skipped"}, no tokens), --no-citations
       (drops items[] from the sources doc but keeps the count
       marker), and --json (--stream-json wins because the
       streaming contract is stricter / more time-sensitive).
       Ignored with --out — they are incompatible (live emit vs
       file capture); the operator wanting both should shell-
       redirect.

    4. test(stale): --tsv --since composition pin. The --tsv and
       --since flags landed on stale at different times and were
       each pinned independently. The combined byte layout — the
       tab-separated rows that survive the absolute-date filter
       — was never anchored. Three new tests pin: the base
       composition (only the surviving row in canonical
       path\\tageDays\\tchunkCount\\tsize\\n shape), the order
       preservation (no re-sort introduced by the --since
       filter), and the empty-composition (cutoff dropping every
       row yields a clean empty stream, wc -l sees exactly 0).
       Pure regression-guard commit; no source change.

    5. watch --once --since. Pairs the previous tick's --once
       mode with the `ingest --since` mtime filter so a cron
       tick can ride out a quiet workspace without re-walking
       every file. Implementation mirrors `ingest --since`
       byte-for-byte: cutoff inclusive (>=), parse failures
       abort up front BEFORE buildRuntime (typo cannot waste
       runtime warmup), stat() failures on individual files are
       non-fatal (silent drop, cron log stays clean). --since
       is IGNORED without --once (the live watcher relies on
       chokidar to fire on actual file events, so an mtime
       cutoff would be a confusing no-op). Test approach: added
       a node:fs/promises mock that returns configured mtimes
       per path and throws ENOENT for unconfigured paths (which
       the production --since swallows silently); seven tests
       pin the full contract including the inclusive boundary
       (mtime === cutoff is KEPT), the validation order
       (--since's error wins when --debounce is valid but
       --since is typo'd), and the empty-survivor tick (still
       calls ingestPaths([]) so metric counters increment
       normally).

  Push: e3ca380..8496320 main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.
  Verify-gate note: ran `pnpm --filter @clawmind/cli test`
  (423/423 pass), `pnpm --filter @clawmind/cli typecheck`
  (clean), `pnpm typecheck` (only red is the queued telemetry
  OpenTelemetry peer mismatch — same as every prior tick),
  `pnpm --filter @clawmind/rag test` (47/48 pass — queued
  hybrid alpha-blend red, neither introduced nor touched this
  tick), `pnpm --filter @clawmind/api test` (1229/1230 in
  parallel; api-key-bruteforce timing flake isolated to 10/10
  on a clean re-run, same flake as every prior tick).

  Theme connector: this is the fifth consecutive queued-sweep
  tick. The cli's "cron-friendly" identity is now noticeably
  stronger across four dimensions:
    - real-time monitoring: --watch + --max-polls on status
      gives a refreshing dashboard with bounded exit semantics
    - retrieval diagnostics: --above/--below on related closes
      the symmetric-filter family that pins/mutes/aliases and
      feedback already had
    - live UI streaming: --stream-json on ask gives a token-
      by-token NDJSON shape that the existing --json (assembled
      at end) and text mode (ANSI on stdout) could not provide
    - incremental refresh: --once --since on watch makes the
      one-shot path as cheap as `ingest --since`, completing
      the parity between the two commands' cron-friendly
      surfaces

- 2026-06-21 23:08 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 696cce6, c712abb, 738037b, c8f3810, 1b4b63c. Test gate:
  `@clawmind/cli` 450/450 vitest pass (up from 423). 27 net new tests
  spread across 4 files: status.test.ts (+11 -> 25, banner + check-after),
  watch.test.ts (+9 -> 47, --paths-only block), ask.test.ts (+3 -> 24,
  --stream-json --out replaces silent-ignore + adds 3 new), feedback-
  digest.test.ts (+4 -> 81, slim --since byte-layout pins).
  `@clawmind/cli` typecheck: clean. Same two pre-existing reds outside
  cli (telemetry OpenTelemetry 1.x/2.x peer mismatch + rag/hybrid test
  alpha-blend drift); both verified pre-existing in this tick by
  running `pnpm --filter @clawmind/rag test` (47/48, the alpha-blend
  fail is the queued one, error identical to every prior tick) and
  `pnpm --filter @clawmind/api test` (1229/1230, the timing flake on
  api-key-bruteforce/expires-the-lock-naturally is the queued one,
  identical to every prior tick). Neither introduced this tick.

  Theme: the queued sweep, again — but this time TWO of the queued
  items had subtle subtext that made them more than just "tick the
  box". The --check-after debounce on status --watch is the first
  cli flag that semantically operates on EXIT CODE only (not on body
  shape) — every previous --check-style flag flipped both. The
  --stream-json --out composition is the first time the cli has held
  a FileHandle open across a generator's lifetime (every prior --out
  call collected in memory + writeFile-once at the end); needed
  careful close() bookkeeping on every early-exit path so a tail -f
  consumer never sees a stale partial stream.

    1. status --watch banner. The third "stderr restart marker"
       contract in the cli (after watch's own banner, plus the
       implicit "Watching <root>" stdout line). Mirrors the watch
       command's banner byte-for-byte in SHAPE (kind=banner + ts)
       but with two extra fields that make sense for the polling
       use-case: apiBase (which dashboard restarted) and interval
       (at what cadence — useful when a single host runs multiple
       --watch instances at different intervals for different
       criticality tiers). Fires ONCE at loop start, BEFORE the
       first cycle, unconditionally regardless of --json mode so
       a stderr-tailing scraper detects restarts without parsing
       the (potentially noisy) stdout snapshot stream. Suppressed
       on the one-shot path (no loop to mark) and on the --watch
       validation error path (no half-started process to mark) —
       both paths exit before reaching the banner emit. The
       `apiBase` field also helps an operator running the same
       command across staging + prod from a single shell catch
       a "wait I pointed at the wrong env" mistake immediately.

    2. status --watch --check-after <n>. The "1-cycle blip" guard
       on the --check exit code. Without it, --check on a 5-min
       --watch loop with a flaky provider trips exit 2 on a single
       probe timeout — operators learned to wrap the command in
       a manual "retry 3 times" shell loop to avoid alert fatigue.
       --check-after N counts CONSECUTIVE down-cycles ending at
       the final snapshot; only if the streak is >= N does --check
       fire exit 2. A recovery cycle resets the streak to 0 so a
       single probe coming back up immediately re-arms the
       debounce — the contract is "alert only on sustained
       outages", not "alert on any blip you ever saw". Critical
       design: the debounce applies to EXIT CODE only — every
       cycle's snapshot body is unchanged, so a JSON consumer
       graphing `ok` over time sees every blip (which it should).
       Without --check-after the legacy contract holds verbatim
       (any final non-ok trips exit 2). Validation rejects 0 / NaN
       because a typo'd --check-after 0 silently behaving like
       --check alone is the worst possible failure mode for the
       flag's purpose. Silently ignored without --check (matches
       the precedent set by --max-polls without --watch).

    3. watch --once --paths-only. Pure preview, no ingest. Mirrors
       `ingest --dry-run --paths-only` and `reindex --dry-run
       --paths-only` byte-for-byte (same xargs-safe path-per-line
       contract) but lives on the watch command surface so the
       cron muscle memory carries: `watch --once --since X
       --paths-only` is the natural "what would the next
       scheduled refresh tick touch?" probe without spending any
       read/embed/upsert work. The dedupe uses a Set + ordered
       deduped[] array (NOT a for-of over the Set, which TS2802
       would flag on the cli's es2018 target). Composes with
       --since: the preview list is exactly the post-cutoff
       survivors — pin that the preview is byte-faithful to what
       `--once --since` (without --paths-only) would have ingested.
       Wins over --json (matches forget/search/related --paths-only
       short-circuit precedent). Skips ingestPaths() entirely —
       the lance/bm25/manifest are not touched, no metric
       counters increment. Silently ignored without --once (live
       watcher emits per-event NDJSON which is the preview shape
       for that surface).

    4. ask --stream-json --out. Previously a silent-ignore combo:
       --out won, --stream-json was dropped, the operator who
       wanted both a live stream AND a persistent file had to
       shell-redirect (`clawmind ask ... --stream-json >
       stream.ndjson`). That works but reads awkwardly in a script
       and the operator loses the stderr confirmation. Now the
       two flags compose: the NDJSON event stream is appended to
       the file as each event arrives (one write per event so a
       `tail -f` consumer reads the stream in real time), stdout
       stays SILENT, stderr gets the green "wrote answer (N chars)
       -> file" confirmation when the stream completes. Critical
       implementation detail: open('w') clears the file ONCE up
       front (stale stream from a previous run cannot poison the
       new one), then writes via a held FileHandle. The handle is
       closed on completion AND on every early-exit path
       (--threshold skip, error event, errored flag) — the close
       calls had to be plumbed in carefully because the existing
       skip/error paths used `process.exit(1)` which skips
       finally blocks. Also short-circuits the text-mode --out
       fallback below so the file only ever contains the NDJSON
       events, never the human-readable body. The first --out
       contract in the cli that holds a file open across a
       generator's lifetime — useful precedent for any future
       streaming-to-file flag.

    5. test(digest): --json --slim --since exact byte-layout pin.
       Pure regression-guard commit (no source change). The slim
       shape + --since composition was already covered at the
       COUNT level (existing tests assert {ran, deferred,
       sinceSkipped} are the right integers). What was missing:
       an exact-byte-layout pin for the canonical cron probe
       shape `clawmind digest run --since X --max N --json --slim`.
       A future regression where the slim shape silently grew an
       extra key (`skipped` re-added "for backwards compat", or
       a `ts` timestamp) would break NDJSON snapshot diffs across
       ticks without surfacing a test failure under count-only
       assertions. The three shapes pinned are the three meaningful
       cron-probe outcomes: mixed survivors, all-deferred (cap
       exhausts before cutoff matters), all-sinceSkipped (cutoff
       hides everything). Plus a cross-tick stability test: two
       consecutive ticks against the same data produce IDENTICAL
       byte layouts.

  Push: 8dc6ea1..1b4b63c main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.
  Verify-gate note: ran `pnpm run ci:verify` which hit the same
  pre-existing telemetry typecheck red (queued since 2026-06-20
  04:25 PDT; pnpm typecheck on `@clawmind/cli` alone is clean).
  Ran the full `@clawmind/cli` test suite at 450/450; full
  `@clawmind/rag` at 47/48 (queued hybrid alpha-blend); full
  `@clawmind/api` at 1229/1230 (timing flake on api-key-bruteforce
  expires-the-lock-naturally — identical to every prior tick).
  No new reds introduced this tick.
