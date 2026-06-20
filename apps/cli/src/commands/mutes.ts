import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

// CLI shim over the /v1/mutes HTTP endpoints. Same shape as `pins` because
// the two are conceptual mirrors: one biases retrieval toward a source, the
// other away from it.

class MutesCliError extends Error {}

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
    throw new MutesCliError(`cannot reach ${base} (${msg})`);
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
    throw new MutesCliError(`${res.status} ${res.statusText}${suffix}`);
  }
  return res.json();
}

async function runOrReport(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof MutesCliError) {
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

export function mutesCommand() {
  const cmd = new Command('mutes').description('Mute sources so retrieval pushes them to the back');

  cmd.command('add <path>')
    .description('Mute a source path with an optional reason. Use "dir/**" to mute a whole folder.')
    .option('-r, --reason <text>', 'short reminder about why this is muted')
    .action(async (path: string, opts: { reason?: string }) => {
      await runOrReport('mutes add', async () => {
        const out = await apiFetch('POST', '/v1/mutes', { path, reason: opts.reason });
        const e = out as { path: string; reason?: string };
        process.stdout.write(kleur.yellow(`muted ${e.path}`) + (e.reason ? kleur.gray(` (${e.reason})`) : '') + '\n');
      });
    });

  cmd.command('remove <path>')
    .alias('rm')
    .description('Remove a mute')
    .action(async (path: string) => {
      await runOrReport('mutes remove', async () => {
        await apiFetch('DELETE', '/v1/mutes', { path });
        process.stdout.write(kleur.gray(`unmuted ${path}\n`));
      });
    });

  cmd.command('list')
    .description('List currently muted sources, newest first')
    .option('-q, --q <text>', 'case-insensitive substring filter across path and reason')
    .option('--paths', 'emit only the muted paths, one per line, with no styling or reasons (pipe-friendly)')
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { q?: string; paths?: boolean; json?: boolean }) => {
      await runOrReport('mutes list', async () => {
        const qs = opts.q ? `?q=${encodeURIComponent(opts.q)}` : '';
        const out = (await apiFetch('GET', `/v1/mutes${qs}`)) as {
          items: { path: string; reason?: string; mutedAt: number; mutedBy: string }[];
          count: number;
        };
        if (opts.json) {
          process.stdout.write(JSON.stringify(out, null, 2) + '\n');
          return;
        }
        // --paths is the pipe-friendly twin of `pins list --paths` /
        // `stale --paths` / `forget --paths-only`. Drops every styled byte
        // (no header, no "no muted sources" hint, no colour, no reason)
        // so `clawmind mutes list --paths | xargs -n1 clawmind mutes rm`
        // (or `xargs -n1 clawmind forget --apply`) works without
        // conditional skips. -q still narrows the set first; zero matches
        // yields a clean empty stream.
        if (opts.paths) {
          for (const it of out.items) process.stdout.write(`${it.path}\n`);
          return;
        }
        if (out.count === 0) { process.stdout.write(kleur.gray('no muted sources\n')); return; }
        for (const it of out.items) {
          const head = kleur.bold(it.path);
          const tail = kleur.gray(`(${fmtDate(it.mutedAt)} by ${it.mutedBy})`);
          process.stdout.write(`${head} ${tail}\n`);
          if (it.reason) process.stdout.write(kleur.dim(`    ${it.reason}\n`));
        }
      });
    });

  return cmd;
}
