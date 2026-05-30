import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

// CLI for the /v1/sources/stale endpoint. Prints sources whose last ingest
// is older than the threshold, oldest first. Designed for piping: with
// --paths only the path column is emitted, suitable for feeding into
// `clawmind reindex --files -`.

async function apiFetch(method: string, path: string) {
  const env = loadEnv();
  const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
  const res = await fetch(`${base}${path}`, { method });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
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
    .option('--paths', 'print just the path column for piping into other commands')
    .action(async (opts: { days: string; limit: string; paths?: boolean }) => {
      const qs = new URLSearchParams({
        olderThanDays: opts.days,
        limit: opts.limit,
      }).toString();
      const out = (await apiFetch('GET', `/v1/sources/stale?${qs}`)) as {
        thresholdDays: number;
        total: number;
        items: { path: string; ageDays: number; chunkCount: number; size: number }[];
      };
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
  return cmd;
}
