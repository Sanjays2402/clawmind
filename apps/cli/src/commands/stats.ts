import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

interface NamespaceStats {
  namespace: string;
  files: number;
  chunks: number;
  bytes: number;
  oldestIngestedAt: number | null;
  newestIngestedAt: number | null;
  extensions: { ext: string; count: number }[];
}

interface StatsReport {
  totals: { files: number; chunks: number; bytes: number; namespaces: number };
  byNamespace: NamespaceStats[];
  generatedAt: number;
}

class StatsCliError extends Error {}

async function apiFetch(method: string, path: string) {
  const env = loadEnv();
  const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new StatsCliError(`cannot reach ${base} (${msg})`);
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
    throw new StatsCliError(`(${res.status} ${res.statusText})${suffix}`);
  }
  return res.json();
}

async function runOrReport(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof StatsCliError) {
      process.stderr.write(kleur.red(`${label} failed: ${err.message}\n`));
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtAge(ms: number | null): string {
  if (ms === null) return 'never';
  const delta = Date.now() - ms;
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

export function statsCommand() {
  return new Command('stats')
    .description('Per-namespace breakdown of indexed files, chunks, and bytes')
    .option('-q, --query <substr>', 'only include namespaces whose name contains this substring (case-insensitive)')
    .option('--json', 'emit machine-readable JSON instead of a text table')
    .action(async (opts: { json?: boolean; query?: string }) => {
      await runOrReport('stats', async () => {
        let report = (await apiFetch('GET', '/v1/stats')) as StatsReport;
        if (opts.query) {
          const needle = opts.query.toLowerCase();
          const byNamespace = report.byNamespace.filter((n) => n.namespace.toLowerCase().includes(needle));
          const totals = byNamespace.reduce(
            (acc, n) => {
              acc.files += n.files;
              acc.chunks += n.chunks;
              acc.bytes += n.bytes;
              return acc;
            },
            { files: 0, chunks: 0, bytes: 0, namespaces: byNamespace.length },
          );
          report = { ...report, byNamespace, totals };
        }
        if (opts.json) {
          process.stdout.write(JSON.stringify(report, null, 2) + '\n');
          return;
        }
        process.stdout.write(
          kleur.bold(
            `${report.totals.files} files, ${report.totals.chunks} chunks, ` +
            `${fmtBytes(report.totals.bytes)} across ${report.totals.namespaces} namespaces\n\n`,
          ),
        );
        if (report.byNamespace.length === 0) {
          process.stdout.write(kleur.gray('no files indexed yet\n'));
          return;
        }
        for (const ns of report.byNamespace) {
          const top = ns.extensions.slice(0, 4).map((e) => `${e.ext}:${e.count}`).join(' ');
          process.stdout.write(
            `${kleur.cyan(ns.namespace.padEnd(10))} ` +
            `${String(ns.files).padStart(6)} files  ` +
            `${String(ns.chunks).padStart(7)} chunks  ` +
            `${fmtBytes(ns.bytes).padStart(10)}  ` +
            kleur.gray(`updated ${fmtAge(ns.newestIngestedAt)}  [${top}]\n`),
          );
        }
      });
    });
}
