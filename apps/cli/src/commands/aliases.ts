import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

// CLI shim over the /v1/aliases HTTP endpoints. Aliases are workspace-wide
// shortcuts (e.g. "@notes" -> "/Users/me/.openclaw/workspace/notes") that
// the API expands inside queries and uses to shorten cited paths.

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

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export function aliasesCommand() {
  const cmd = new Command('aliases').description('Short, memorable names for long source paths');

  cmd.command('add <name> <path>')
    .description('Create or replace an alias (name must match [a-z0-9][a-z0-9_-]*)')
    .action(async (name: string, path: string) => {
      const out = await apiFetch('POST', '/v1/aliases', { name, path });
      const e = out as { name: string; path: string };
      process.stdout.write(kleur.green(`@${e.name}`) + kleur.gray(` -> ${e.path}\n`));
    });

  cmd.command('remove <name>')
    .alias('rm')
    .description('Remove an alias')
    .action(async (name: string) => {
      await apiFetch('DELETE', '/v1/aliases', { name });
      process.stdout.write(kleur.gray(`removed @${name}\n`));
    });

  cmd.command('list')
    .description('List aliases sorted by name')
    .option('-q, --q <text>', 'case-insensitive substring filter across name and path')
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { q?: string; json?: boolean }) => {
      const qs = opts.q ? `?q=${encodeURIComponent(opts.q)}` : '';
      const out = (await apiFetch('GET', `/v1/aliases${qs}`)) as {
        items: { name: string; path: string; createdAt: number; createdBy: string }[];
        count: number;
      };
      if (opts.json) {
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
        return;
      }
      if (out.count === 0) { process.stdout.write(kleur.gray('no aliases defined\n')); return; }
      for (const it of out.items) {
        const head = kleur.bold(`@${it.name}`);
        const tail = kleur.gray(`(${fmtDate(it.createdAt)} by ${it.createdBy})`);
        process.stdout.write(`${head} ${kleur.cyan('->')} ${it.path} ${tail}\n`);
      }
    });

  return cmd;
}
