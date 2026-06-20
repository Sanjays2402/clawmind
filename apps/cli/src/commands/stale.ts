import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

// CLI for the /v1/sources/stale endpoint. Prints sources whose last ingest
// is older than the threshold, oldest first. Designed for piping: with
// --paths only the path column is emitted, suitable for feeding into
// `clawmind reindex --files -`.

class StaleCliError extends Error {}

async function apiFetch(method: string, path: string) {
  const env = loadEnv();
  const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new StaleCliError(`cannot reach ${base} (${msg})`);
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
    throw new StaleCliError(`(${res.status} ${res.statusText})${suffix}`);
  }
  return res.json();
}

async function runOrReport(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof StaleCliError) {
      process.stderr.write(kleur.red(`${label} failed: ${err.message}\n`));
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}

export function staleCommand() {
  const cmd = new Command('stale')
    .description('List sources not re-ingested in N days')
    .option('-d, --days <n>', 'staleness threshold in days', '30')
    .option('-l, --limit <n>', 'cap on rows returned', '200')
    .option('-q, --q <text>', 'case-insensitive substring filter on path')
    .option('--paths', 'print just the path column for piping into other commands')
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { days: string; limit: string; paths?: boolean; q?: string; json?: boolean }) => {
      await runOrReport('stale', async () => {
        const params: Record<string, string> = {
          olderThanDays: opts.days,
          limit: opts.limit,
        };
        if (opts.q) params.q = opts.q;
        const qs = new URLSearchParams(params).toString();
        const out = (await apiFetch('GET', `/v1/sources/stale?${qs}`)) as {
          thresholdDays: number;
          total: number;
          items: { path: string; ageDays: number; chunkCount: number; size: number }[];
        };
        if (opts.json) {
          process.stdout.write(JSON.stringify(out, null, 2) + '\n');
          return;
        }
        if (opts.paths) {
          for (const it of out.items) process.stdout.write(`${it.path}\n`);
          return;
        }
        if (out.total === 0) {
          process.stdout.write(kleur.gray(`no sources stale beyond ${out.thresholdDays}d\n`));
          return;
        }
        const shown = out.items.length;
        const header = `${out.total} stale (older than ${out.thresholdDays}d), showing ${shown}`;
        process.stdout.write(kleur.bold(header) + '\n');
        for (const it of out.items) {
          const age = kleur.yellow(`${it.ageDays}d`.padStart(5));
          const size = kleur.gray(fmtBytes(it.size).padStart(6));
          const chunks = kleur.gray(`${it.chunkCount}c`.padStart(5));
          process.stdout.write(`${age} ${size} ${chunks}  ${it.path}\n`);
        }
      });
    });
  return cmd;
}
