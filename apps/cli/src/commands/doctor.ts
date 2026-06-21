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
    .option('--json', 'emit machine-readable JSON instead of a text report')
    .action(async (opts: { severity: string; json?: boolean }) => {
      const env = loadEnv();
      const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
      let res: Response;
      try {
        res = await fetch(`${base}/v1/doctor`);
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
