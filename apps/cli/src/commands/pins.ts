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
    .option('--since <iso-date>', 'keep only pins whose pinnedAt is at-or-after this ISO date. The natural cron use is a daily snapshot of "what got pinned in the last 24h" without scrolling through every entry: `clawmind pins list --since "$(date -u -d \'1 day ago\' +%FT%TZ)" --paths`. Composes with -q (intersection: pin must both match the substring AND be recent enough). Cutoff is INCLUSIVE (>=) so a pin created exactly at the cutoff is kept — matches the existing --since semantics on stale / stats / digest show. Parse failures abort cleanly with exit code 1.')
    .option('--by <user>', 'keep only pins whose pinnedBy matches this user id EXACTLY. The natural cron use is scoping a daily snapshot to a specific creator in a multi-user workspace where the pin map grows fast — `clawmind pins list --by sanjay --since "$(date -u -d \'1 day ago\' +%FT%TZ)"` answers "what did Sanjay pin today" without scrolling through every member\'s additions. Exact-match semantics (not substring) so the filter is deterministic and pin maps with overlapping user-id prefixes (`sanjay-readonly` vs `sanjay`) don\'t bleed. Composes with -q and --since as an intersection. Filter applies BEFORE --paths / --json / text rendering so every output mode sees the same filtered subset and the recomputed count reflects the filtered length. An empty match yields a clean empty stream / `count: 0` payload — same shape as zero matches from --since or -q.')
    .option('--paths', 'emit only the pinned paths, one per line, with no styling or notes (pipe-friendly)')
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { q?: string; since?: string; by?: string; paths?: boolean; json?: boolean }) => {
      await runOrReport('pins list', async () => {
        const qs = opts.q ? `?q=${encodeURIComponent(opts.q)}` : '';
        let out = (await apiFetch('GET', `/v1/pins${qs}`)) as {
          items: { path: string; note?: string; pinnedAt: number; pinnedBy: string }[];
          count: number;
        };
        // --since <iso-date> is a client-side post-filter on
        // pinnedAt. The /v1/pins endpoint already returns items
        // newest-first (sorted by pinnedAt descending) so the
        // filter just slices the suffix off — but doing it
        // client-side is the right shape because the API does not
        // currently accept a `since` parameter and exposing the
        // dial on the cli avoids an API change for a presentational
        // narrowing.
        //
        // Cutoff is INCLUSIVE (>=) so a pin created at exactly the
        // cutoff timestamp is KEPT — matches the existing --since
        // semantics on stale / stats / digest show. Parse failures
        // abort with exit code 1 via the standard PinsCliError
        // path so a typo cannot silently degrade to "no filter"
        // (which would defeat the cron use of "show me only the
        // recent pins" — falling back to the full list is the
        // exact wrong answer).
        //
        // Filter applies BEFORE --paths / --json / text rendering
        // so every output mode sees the same subset and the
        // recomputed count below reflects the filtered length.
        if (opts.since) {
          const cutoff = Date.parse(opts.since);
          if (!Number.isFinite(cutoff)) {
            throw new PinsCliError(`--since value "${opts.since}" is not a valid ISO date`);
          }
          const items = out.items.filter((it) => it.pinnedAt >= cutoff);
          out = { ...out, items, count: items.length };
        }
        // --by <user> is a client-side post-filter on pinnedBy.
        // EXACT-MATCH semantics (===, not substring/contains) so
        // a pin map with overlapping user-id prefixes (e.g.
        // `sanjay` vs `sanjay-readonly`) does not bleed across
        // the filter — a cron operator asking "what did Sanjay
        // pin" gets exactly Sanjay's pins, not the union of every
        // user whose id starts with `sanjay`. The deterministic
        // contract also means a test fixture pinning byte
        // layouts (this section's tests pin them) cannot drift
        // when a new user is added to the workspace.
        //
        // We apply it AFTER --since so the intersection is
        // "creator AND recency" — the natural cron question
        // ("what did Sanjay pin in the last 24h"). Composes with
        // -q (the substring filter, which fires server-side via
        // the ?q= query string) as a further intersection client-
        // side: -q narrows by content first, --by narrows by
        // creator second, --since narrows by recency third, all
        // applied BEFORE the --paths / --json / text short-circuit
        // so the recomputed count reflects every filter that ran.
        if (opts.by !== undefined) {
          const items = out.items.filter((it) => it.pinnedBy === opts.by);
          out = { ...out, items, count: items.length };
        }
        if (opts.json) {
          process.stdout.write(JSON.stringify(out, null, 2) + '\n');
          return;
        }
        // --paths is the pipe-friendly twin of `stale --paths` / `forget
        // --paths-only`. It drops every styled byte (no header, no "no
        // pinned sources" hint, no colour, no note line) so things like
        // `clawmind pins list --paths | xargs -n1 clawmind forget --apply`
        // work without conditional skips. -q still narrows the set before
        // we emit. Zero matches yields a clean empty stream — same
        // contract as `forget --paths-only`.
        if (opts.paths) {
          for (const it of out.items) process.stdout.write(`${it.path}\n`);
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
