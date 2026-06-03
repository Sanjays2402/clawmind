import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

async function apiFetch(method: string, path: string, body?: unknown) {
  const env = loadEnv();
  const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

function fmtTime(ts: number | null) {
  if (!ts) return kleur.gray('never');
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

export function digestCommand() {
  const cmd = new Command('digest').description('Re-run saved searches and show what changed');

  cmd.command('list')
    .description('List saved searches with last digest run summary')
    .option('-q, --q <text>', 'case-insensitive substring filter across id, title, and query')
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { q?: string; json?: boolean }) => {
      const qs = opts.q ? `?q=${encodeURIComponent(opts.q)}` : '';
      const out = (await apiFetch('GET', `/v1/digests${qs}`)) as {
        items: {
          savedSearchId: string; title: string; query: string;
          lastRunTs: number | null; lastNewCount: number; lastRemovedCount: number; runs: number;
        }[];
      };
      if (opts.json) {
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
        return;
      }
      if (out.items.length === 0) { process.stdout.write(kleur.gray('no saved searches\n')); return; }
      for (const it of out.items) {
        process.stdout.write(
          `${kleur.bold(it.title)}  ${kleur.gray(it.savedSearchId)}\n` +
          `  ${kleur.gray('query:')} ${it.query}\n` +
          `  ${kleur.gray('last:')}  ${fmtTime(it.lastRunTs)}  ` +
          `${kleur.green(`+${it.lastNewCount}`)} ${kleur.red(`-${it.lastRemovedCount}`)}  ` +
          `${kleur.gray(`(${it.runs} runs)`)}\n`,
        );
      }
    });

  cmd.command('run [id]')
    .description('Run one saved search by id, or all if no id given')
    .option('--json', 'emit the run report as JSON for scripting')
    .action(async (id: string | undefined, opts: { json?: boolean }) => {
      if (id) {
        const out = (await apiFetch('POST', `/v1/digests/${id}/run`)) as {
          entry: { newSources: { path: string }[]; removedSources: string[] };
        };
        if (opts.json) {
          process.stdout.write(JSON.stringify(out, null, 2) + '\n');
          return;
        }
        process.stdout.write(kleur.green(`new (${out.entry.newSources.length}):\n`));
        for (const s of out.entry.newSources) process.stdout.write(`  + ${s.path}\n`);
        process.stdout.write(kleur.red(`removed (${out.entry.removedSources.length}):\n`));
        for (const r of out.entry.removedSources) process.stdout.write(`  - ${r}\n`);
      } else {
        const out = (await apiFetch('POST', '/v1/digests/run')) as {
          ran: number; results: { savedSearchId: string; newCount: number; removedCount: number }[];
        };
        if (opts.json) {
          process.stdout.write(JSON.stringify(out, null, 2) + '\n');
          return;
        }
        process.stdout.write(kleur.gray(`ran ${out.ran} saved searches\n`));
        for (const r of out.results) {
          process.stdout.write(`  ${r.savedSearchId}  ${kleur.green(`+${r.newCount}`)} ${kleur.red(`-${r.removedCount}`)}\n`);
        }
      }
    });

  cmd.command('show <id>')
    .description('Show full run history for one saved search')
    .option('--json', 'emit the history as JSON for scripting')
    .action(async (id: string, opts: { json?: boolean }) => {
      const out = (await apiFetch('GET', `/v1/digests/${id}`)) as {
        state: { query: string; history: { ts: number; newSources: { path: string }[]; removedSources: string[]; totalSources: number }[] };
      };
      if (opts.json) {
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
        return;
      }
      process.stdout.write(kleur.gray(`query: ${out.state.query}\n`));
      for (const h of out.state.history) {
        process.stdout.write(
          `${fmtTime(h.ts)}  ` +
          `${kleur.green(`+${h.newSources.length}`)} ${kleur.red(`-${h.removedSources.length}`)}  ` +
          `(${h.totalSources} total)\n`,
        );
      }
    });

  return cmd;
}
