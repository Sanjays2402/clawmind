import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

// CLI shim over the /v1/pins HTTP endpoints. The API process owns the
// persisted pin map so the CLI, the web UI, and a script driving the HTTP
// API all see the same set of pinned sources.

class PinsCliError extends Error {}

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
    throw new PinsCliError(`cannot reach ${base} (${msg})`);
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
    throw new PinsCliError(`${res.status} ${res.statusText}${suffix}`);
  }
  return res.json();
}

async function runOrReport(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof PinsCliError) {
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

export function pinsCommand() {
  const cmd = new Command('pins').description('Pin sources so retrieval always considers them strongly');

  cmd.command('add <path>')
    .description('Pin a source path with an optional note')
    .option('-n, --note <text>', 'short reminder about why this is pinned')
    .action(async (path: string, opts: { note?: string }) => {
      await runOrReport('pins add', async () => {
        const out = await apiFetch('POST', '/v1/pins', { path, note: opts.note });
        const e = out as { path: string; note?: string };
        process.stdout.write(kleur.green(`pinned ${e.path}`) + (e.note ? kleur.gray(` (${e.note})`) : '') + '\n');
      });
    });

  cmd.command('remove <path>')
    .alias('rm')
    .description('Remove a pin')
    .action(async (path: string) => {
      await runOrReport('pins remove', async () => {
        await apiFetch('DELETE', '/v1/pins', { path });
        process.stdout.write(kleur.gray(`unpinned ${path}\n`));
      });
    });

  cmd.command('list')
    .description('List currently pinned sources, newest first')
    .option('-q, --q <text>', 'case-insensitive substring filter across path and note')
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { q?: string; json?: boolean }) => {
      await runOrReport('pins list', async () => {
        const qs = opts.q ? `?q=${encodeURIComponent(opts.q)}` : '';
        const out = (await apiFetch('GET', `/v1/pins${qs}`)) as {
          items: { path: string; note?: string; pinnedAt: number; pinnedBy: string }[];
          count: number;
        };
        if (opts.json) {
          process.stdout.write(JSON.stringify(out, null, 2) + '\n');
          return;
        }
        if (out.count === 0) { process.stdout.write(kleur.gray('no pinned sources\n')); return; }
        for (const it of out.items) {
          const head = kleur.bold(it.path);
          const tail = kleur.gray(`(${fmtDate(it.pinnedAt)} by ${it.pinnedBy})`);
          process.stdout.write(`${head} ${tail}\n`);
          if (it.note) process.stdout.write(kleur.dim(`    ${it.note}\n`));
        }
      });
    });

  return cmd;
}
