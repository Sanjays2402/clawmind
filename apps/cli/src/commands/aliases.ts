import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

// CLI shim over the /v1/aliases HTTP endpoints. Aliases are workspace-wide
// shortcuts (e.g. "@notes" -> "/Users/me/.openclaw/workspace/notes") that
// the API expands inside queries and uses to shorten cited paths.

class AliasesCliError extends Error {}

async function apiFetch(method: string, path: string, body?: unknown) {
  const env = loadEnv();
  const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AliasesCliError(`cannot reach ${base} (${msg})`);
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
    throw new AliasesCliError(`(${res.status} ${res.statusText})${suffix}`);
  }
  return res.json();
}

async function runOrReport(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof AliasesCliError) {
      process.stderr.write(kleur.red(`${label} failed: ${err.message}\n`));
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export function aliasesCommand() {
  const cmd = new Command('aliases').description('Short, memorable names for long source paths');

  cmd.command('add <name> <path>')
    .description('Create or replace an alias (name must match [a-z0-9][a-z0-9_-]*)')
    .action(async (name: string, path: string) => {
      await runOrReport('aliases add', async () => {
        const out = await apiFetch('POST', '/v1/aliases', { name, path });
        const e = out as { name: string; path: string };
        process.stdout.write(kleur.green(`@${e.name}`) + kleur.gray(` -> ${e.path}\n`));
      });
    });

  cmd.command('remove <name>')
    .alias('rm')
    .description('Remove an alias')
    .action(async (name: string) => {
      await runOrReport('aliases remove', async () => {
        await apiFetch('DELETE', '/v1/aliases', { name });
        process.stdout.write(kleur.gray(`removed @${name}\n`));
      });
    });

  cmd.command('list')
    .description('List aliases sorted by name')
    .option('-q, --q <text>', 'case-insensitive substring filter across name and path')
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { q?: string; json?: boolean }) => {
      await runOrReport('aliases list', async () => {
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
    });

  return cmd;
}
