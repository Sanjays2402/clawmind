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
    .option('--since <iso-date>', 'keep only mutes whose mutedAt is at-or-after this ISO date. Mirrors `pins list --since` byte-for-byte (cron snapshot of "what got muted in the last 24h"). Composes with -q as an intersection. Cutoff is INCLUSIVE (>=). Parse failures abort cleanly with exit code 1.')
    .option('--by <user>', 'keep only mutes whose mutedBy matches this user id EXACTLY. Mirrors `pins list --by` byte-for-byte — the symmetry is intentional because a cron operator scripting per-user snapshots wants the same flag on both sides of the pin/mute pair. Exact-match semantics so overlapping user-id prefixes do not bleed. Composes with -q and --since as an intersection. Filter applies BEFORE --paths / --json / text rendering so every output mode sees the same subset and the recomputed count reflects the filtered length.')
    .option('--paths', 'emit only the muted paths, one per line, with no styling or reasons (pipe-friendly)')
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { q?: string; since?: string; by?: string; paths?: boolean; json?: boolean }) => {
      await runOrReport('mutes list', async () => {
        const qs = opts.q ? `?q=${encodeURIComponent(opts.q)}` : '';
        let out = (await apiFetch('GET', `/v1/mutes${qs}`)) as {
          items: { path: string; reason?: string; mutedAt: number; mutedBy: string }[];
          count: number;
        };
        // --since <iso-date> is a client-side post-filter on
        // mutedAt. Same shape as `pins list --since` — the API
        // returns items newest-first sorted by mutedAt, so the
        // filter just slices the suffix off. Cutoff INCLUSIVE
        // (>=); parse failures throw a MutesCliError that the
        // standard error path surfaces with exit code 1; filter
        // applies BEFORE --paths / --json / text rendering so
        // every output mode sees the same filtered subset and
        // the recomputed count reflects the filtered length.
        // The symmetry with `pins list --since` is intentional —
        // a cron operator scripting daily snapshots wants the
        // same flag on both sides of the pin/mute pair.
        if (opts.since) {
          const cutoff = Date.parse(opts.since);
          if (!Number.isFinite(cutoff)) {
            throw new MutesCliError(`--since value "${opts.since}" is not a valid ISO date`);
          }
          const items = out.items.filter((it) => it.mutedAt >= cutoff);
          out = { ...out, items, count: items.length };
        }
        // --by <user> is a client-side post-filter on mutedBy.
        // EXACT-MATCH semantics (===, not substring/contains) so
        // overlapping user-id prefixes do not bleed across the
        // filter. We apply it AFTER --since so the intersection
        // is "creator AND recency" — the natural cron question.
        // Mirrors `pins list --by` byte-for-byte; the symmetry
        // is the entire point so a multi-user workspace can run
        // the same per-user audit on both sides of the pin/mute
        // pair without conditional plumbing.
        if (opts.by !== undefined) {
          const items = out.items.filter((it) => it.mutedBy === opts.by);
          out = { ...out, items, count: items.length };
        }
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
