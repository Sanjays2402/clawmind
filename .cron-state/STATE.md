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
2. JSON / scripting ergonomics (`--json`, `--paths`, `--out`) for piping into
   other tools.
3. Small affordances that show up in Sanjay's day-to-day (filters, latency
   hints, exit codes).

## Roadmap (newest first - work top to bottom each tick)

Status legend: [ ] open, [x] done, [~] in-progress (only ever during a single tick).

### Tick 2026-06-20 04:25 PDT (current)

- [ ] fix(stale): surface clean error when api is unreachable or returns error body
- [ ] fix(forget): surface clean error when api is unreachable or returns error body
- [ ] fix(stats): surface clean error when api is unreachable or returns error body
- [ ] feat(stale): add --tsv option to emit tab-separated path/age/size/chunks for piping
- [ ] feat(status): include the resolved api base url and per-probe latency in status output

### Queued for later ticks

- [ ] fix(reindex): surface clean error when api is unreachable or returns error body
- [ ] fix(watch): surface clean error when api is unreachable or returns error body
- [ ] fix(compact): surface clean error when api is unreachable or returns error body
- [ ] fix(ask): surface clean error when api is unreachable or returns error body
- [ ] fix(ingest): surface clean error when api is unreachable or returns error body
- [ ] fix(status): surface clean error when embed/llm probes fail (return exit 1, not crash)
- [ ] feat(stats): add --top <n> option to cap per-namespace extension breakdown
- [ ] feat(stats): add --sort <files|chunks|bytes> option for the per-namespace table
- [ ] feat(search): add --threshold <n> to filter hits below a relevance score
- [ ] feat(ask): add --no-citations flag for quick non-cited answers
- [ ] feat(ask): add --out option mirroring search --out for saving long answers
- [ ] feat(digest): add -q substring filter to digest history listing
- [ ] feat(watch): add --debounce <ms> option to coalesce rapid file events
- [ ] feat(pins): add --paths option to print just pinned paths for piping
- [ ] feat(mutes): add --paths option to print just muted paths for piping
- [ ] feat(forget): add --paths-only option to emit just the matched paths
- [ ] feat(doctor): exit non-zero if any error-severity finding is present
- [ ] feat(status): add --watch <ms> to repoll periodically for terminal dashboards

## Conventions

- Every CLI fetch helper should wrap the fetch in a single ApiError-style class
  and a per-command label that prefixes both the transport error ("cannot
  reach ...") and the non-2xx error ("foo failed (503 ...): <body>").
- Tests live next to the command file in `apps/cli/test/<name>.test.ts` and
  use the `globalThis.fetch` stub pattern from `doctor.test.ts` /
  `aliases.test.ts`.
- Keep `--json` output stable across non-error paths so downstream scripts
  can pipe with `jq` without conditional handling.

## Tick log

(updated by each tick at the bottom)
