import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

// CLI shim over the /v1/feedback HTTP endpoints. Keeps state in one place
// (the API process owns the data dir) so a vote from `clawmind feedback`
// and a vote from the web UI converge.

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

export function feedbackCommand() {
  const cmd = new Command('feedback').description('Upvote, downvote, list, or clear source feedback');

  cmd.command('up <path>')
    .description('Upvote a source path so retrieval ranks it higher')
    .action(async (path: string) => {
      const out = await apiFetch('POST', '/v1/feedback', { path, vote: 1 });
      process.stdout.write(kleur.green(`+1 ${path} (boost ${(out as { boost: number }).boost.toFixed(2)})\n`));
    });

  cmd.command('down <path>')
    .description('Downvote a source path so retrieval ranks it lower')
    .action(async (path: string) => {
      const out = await apiFetch('POST', '/v1/feedback', { path, vote: -1 });
      process.stdout.write(kleur.yellow(`-1 ${path} (boost ${(out as { boost: number }).boost.toFixed(2)})\n`));
    });

  cmd.command('clear <path>')
    .description('Remove your vote on a source path')
    .action(async (path: string) => {
      await apiFetch('DELETE', '/v1/feedback', { path });
      process.stdout.write(kleur.gray(`cleared vote on ${path}\n`));
    });

  cmd.command('list')
    .description('List current feedback entries with boost multipliers')
    .option('-q, --q <text>', 'case-insensitive substring filter on source path')
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { q?: string; json?: boolean }) => {
      const qs = opts.q ? `?q=${encodeURIComponent(opts.q)}` : '';
      const out = (await apiFetch('GET', `/v1/feedback${qs}`)) as {
        items: { path: string; ups: number; downs: number; boost: number }[];
      };
      if (opts.json) {
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
        return;
      }
      if (out.items.length === 0) { process.stdout.write(kleur.gray('no feedback yet\n')); return; }
      for (const it of out.items) {
        const sign = it.boost > 1 ? kleur.green('+') : it.boost < 1 ? kleur.red('-') : kleur.gray('=');
        process.stdout.write(`${sign} ${it.boost.toFixed(2)}x  ${kleur.bold(it.path)}  ups=${it.ups} downs=${it.downs}\n`);
      }
    });

  return cmd;
}
