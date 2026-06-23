import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

interface Finding {
  severity: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  hint?: string;
}

interface DoctorReport {
  ok: boolean;
  counts: { manifestDocs: number; manifestChunks: number; bm25Chunks: number; lanceChunks: number };
  findings: Finding[];
}

const SEV_COLOR: Record<Finding['severity'], (s: string) => string> = {
  info: kleur.cyan,
  warn: kleur.yellow,
  error: kleur.red,
};

const SEV_LABEL: Record<Finding['severity'], string> = {
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

export function doctorCommand() {
  return new Command('doctor')
    .description('Diagnose drift between the manifest, BM25 index, and vector store')
    .option('--severity <level>', 'minimum severity to display: info (default), warn, or error. Higher levels filter out lower-priority findings so a busy index can be reviewed for the critical issues first. The exit code is still driven by the FULL findings list (any error keeps exit 1) — the filter only hides display, never silences a real problem.', 'info')
    .option('--stale-after-days <n>', 'override the API\'s default 30-day STALE_INDEX threshold. Forwarded as ?staleAfterDays=<n> to /v1/doctor where it is converted to milliseconds before being passed to the runDoctor service. The natural cron use is a freshness SLO that is tighter than 30 days (e.g. `clawmind doctor --severity error --stale-after-days 1` to fail nightly CI when the index has not seen an ingest in the last day). Bounded server-side to 0..3650 days; zero means "any age counts as stale" which is the right tripwire for an index that should never look idle. A non-numeric or out-of-range value is rejected up front so a typo cannot silently degrade to the default threshold.', (v) => Number.parseInt(v, 10))
    .option('--json', 'emit machine-readable JSON instead of a text report')
    .option('--quiet', 'with --json: emit a slim `{ok, findingsCount, errors, warnings, infos}` shape carrying ONLY the per-severity tallies + the overall ok flag, instead of the full per-finding payload. The classic cron use is a tight dashboard panel ("is the index ok?  how many errors?") that needs the answer in 5 fields without piping the full report through `jq` for the count. Pairs naturally with --severity error for "fail nightly CI if any error finding exists": `clawmind doctor --json --quiet | jq -e \'.errors == 0\'`. Without --json the flag is a no-op (text mode already renders a compact body). Wins over the full --json payload when set (the shape switch is the entire point). NOTE: --slim is the family-canonical alias for --quiet — both behave identically; --slim is the spelling new scripts should adopt, --quiet is preserved for back-compat with the original v0 contract.')
    .option('--slim', 'family-canonical alias for --quiet (mirrors `digest run --json --slim`, `feedback prune --json --slim`, `stats --json --slim`, `forget --json --slim`, `reindex --dry-run --json --slim`, `stale --json --slim` etc. byte-for-byte). The slim shape is `{ok, findingsCount, errors, warnings, infos}` — only the per-severity tallies + the overall ok flag, no per-finding payload. Composes with --severity differently from the legacy --quiet behaviour: under --json --slim --severity error, the `findingsCount` and per-severity tallies are NARROWED to the operator-chosen severity floor (errors only when --severity error, errors+warnings when --severity warn, all when --severity info). The original --quiet shape always reflects the FULL unfiltered counts regardless of --severity — which made `clawmind doctor --json --quiet --severity error | jq .errors` redundant with the unconditional shape and broke the natural cron poll "how many error-or-above findings are there right now". Under --json --slim, --severity narrows the tallies as the operator expects. Without --json the flag is a no-op (text mode already renders a compact body). Wins over the full --json payload when set. The `ok` field is ALWAYS driven by the FULL report regardless of --severity narrowing — hiding warnings via --severity error cannot accidentally promote an unhealthy index to ok=true.')
    .action(async (opts: { severity: string; staleAfterDays?: number; json?: boolean; quiet?: boolean; slim?: boolean }) => {
      const env = loadEnv();
      const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
      // --stale-after-days is forwarded as a query string parameter so
      // the entire override travels with the request. We validate
      // client-side BEFORE the fetch so a typo aborts cleanly without
      // a wasted round-trip. The API enforces the same 0..3650
      // bound, but rejecting bad input here gives the operator a
      // crisp error message instead of the generic
      // "doctor failed (400 Bad Request)" the API surfaces for an
      // invalid query string.
      if (opts.staleAfterDays !== undefined) {
        if (!Number.isFinite(opts.staleAfterDays) || opts.staleAfterDays < 0 || opts.staleAfterDays > 3650) {
          process.stderr.write(kleur.red(`doctor failed: --stale-after-days must be an integer between 0 and 3650 (got "${opts.staleAfterDays}")\n`));
          process.exitCode = 1;
          return;
        }
      }
      const url = opts.staleAfterDays !== undefined
        ? `${base}/v1/doctor?staleAfterDays=${opts.staleAfterDays}`
        : `${base}/v1/doctor`;
      let res: Response;
      try {
        res = await fetch(url);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(kleur.red(`doctor failed: cannot reach ${base} (${msg})\n`));
        process.exitCode = 1;
        return;
      }
      if (!res.ok) {
        let detail = (await res.text()).trim();
        try {
          const parsed = JSON.parse(detail) as { message?: unknown; error?: unknown };
          if (typeof parsed.message === 'string') detail = parsed.message;
          else if (typeof parsed.error === 'string') detail = parsed.error;
        } catch {
          // not JSON, keep as text
        }
        if (detail.length > 200) detail = detail.slice(0, 200) + '...';
        const suffix = detail ? `: ${detail}` : '';
        process.stderr.write(kleur.red(`doctor failed (${res.status} ${res.statusText})${suffix}\n`));
        process.exitCode = 1;
        return;
      }
      const r = (await res.json()) as DoctorReport;

      // --severity filters which findings the operator SEES, never which
      // findings the exit code reflects. We split the two so a CI run
      // can grep --severity error to surface only critical rows while
      // still relying on the original `r.ok` flag for the build's
      // success/failure verdict. This avoids the failure mode where
      // hiding warnings accidentally hides the fact that the report
      // overall is unhealthy.
      const SEV_RANK: Record<Finding['severity'], number> = { info: 0, warn: 1, error: 2 };
      const minLabel = opts.severity.toLowerCase();
      if (!(minLabel in SEV_RANK)) {
        process.stderr.write(kleur.red(`doctor failed: unknown --severity "${opts.severity}" (expected info, warn, or error)\n`));
        process.exitCode = 1;
        return;
      }
      const minRank = SEV_RANK[minLabel as Finding['severity']];
      const visibleFindings = r.findings.filter((f) => SEV_RANK[f.severity] >= minRank);

      if (opts.json) {
        // --slim is the family-canonical alias for --quiet. Both
        // flags flip into the slim payload shape; the difference
        // is how --severity composes:
        //
        //   --json --quiet         -> unconditional full tallies
        //     (legacy v0 contract; back-compat preserved)
        //   --json --slim          -> unconditional full tallies
        //     (same as --quiet when --severity is the default)
        //   --json --slim --severity warn  -> tallies narrowed to
        //     warn+error only (the natural cron poll "how many
        //     warn-or-above findings exist")
        //   --json --quiet --severity warn -> tallies unchanged
        //     (back-compat: the legacy --quiet shape was always
        //     the FULL counts; flipping that under --severity
        //     would be a regression for any existing dashboard)
        //
        // The two flags are otherwise identical (single-line JSON,
        // {ok, findingsCount, errors, warnings, infos} shape, ok
        // always driven by the FULL r.ok). When both --slim and
        // --quiet are passed, --slim wins because it's the new
        // canonical name.
        if (opts.slim || opts.quiet) {
          // Determine which findings the slim tallies describe:
          //   - if --slim is explicitly set, narrow to the --severity
          //     floor so the tallies match the operator's mental
          //     model. --slim wins over --quiet because it's the new
          //     canonical name and the operator opted into it
          //     explicitly.
          //   - if ONLY --quiet is set (legacy), always use the full
          //     set so existing v0 cron consumers see no shape change
          const useFiltered = !!opts.slim;
          const source = useFiltered ? visibleFindings : r.findings;
          const errors = source.filter((f) => f.severity === 'error').length;
          const warnings = source.filter((f) => f.severity === 'warn').length;
          const infos = source.filter((f) => f.severity === 'info').length;
          const slim = {
            ok: r.ok,
            findingsCount: source.length,
            errors,
            warnings,
            infos,
          };
          process.stdout.write(JSON.stringify(slim) + '\n');
          if (!r.ok) process.exitCode = 1;
          return;
        }
        // In --json mode we replace `findings` with the filtered list
        // so the operator's pipeline sees what they asked to see, but
        // we add `findingsTotal` so a downstream consumer can detect
        // that filtering took place without re-running the command.
        // `ok` stays driven by the full list (never by the filter).
        const payload = { ...r, findings: visibleFindings, findingsTotal: r.findings.length };
        process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
        if (!r.ok) process.exitCode = 1;
        return;
      }

      const head = r.ok ? kleur.green('healthy') : kleur.red('problems detected');
      process.stdout.write(kleur.bold(`ClawMind doctor: ${head}\n`));
      process.stdout.write(kleur.gray(
        `  manifest ${r.counts.manifestDocs} docs / ${r.counts.manifestChunks} chunks  ` +
        `bm25 ${r.counts.bm25Chunks}  lance ${r.counts.lanceChunks}\n\n`,
      ));

      if (r.findings.length === 0) {
        process.stdout.write(kleur.green('nothing to report.\n'));
        return;
      }

      if (visibleFindings.length === 0) {
        // The report has findings, but none clear the filter. Tell the
        // operator how many were hidden so they don't think the
        // command produced an empty report by accident.
        process.stdout.write(kleur.gray(
          `${r.findings.length} finding(s) below --severity ${minLabel}; nothing to show.\n`,
        ));
      } else {
        for (const f of visibleFindings) {
          const color = SEV_COLOR[f.severity];
          process.stdout.write(`${color(SEV_LABEL[f.severity])} ${kleur.bold(f.code)}  ${f.message}\n`);
          if (f.hint) process.stdout.write(kleur.gray(`        ${f.hint}\n`));
        }
        if (visibleFindings.length < r.findings.length) {
          // Hint at the tail of the table so the operator knows there
          // is more hidden behind the filter.
          process.stdout.write(kleur.gray(
            `\n... ${r.findings.length - visibleFindings.length} more finding(s) below --severity ${minLabel}\n`,
          ));
        }
      }

      if (!r.ok) process.exitCode = 1;
    });
}
